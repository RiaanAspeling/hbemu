// Waveform generation for patient vital signs monitor
// ECG uses simplified mathematical model with PQRST morphology

const Waveforms = {
    // Generate a single ECG sample for a given phase (0..1 within one heartbeat)
    ecgNormal(phase) {
        // P wave
        let val = 0.12 * Math.exp(-Math.pow((phase - 0.12) / 0.02, 2));
        // Q wave
        val -= 0.07 * Math.exp(-Math.pow((phase - 0.19) / 0.007, 2));
        // R wave
        val += 0.85 * Math.exp(-Math.pow((phase - 0.20) / 0.008, 2));
        // S wave
        val -= 0.12 * Math.exp(-Math.pow((phase - 0.215) / 0.006, 2));
        // T wave
        val += 0.18 * Math.exp(-Math.pow((phase - 0.32) / 0.03, 2));
        // U wave (subtle)
        val += 0.02 * Math.exp(-Math.pow((phase - 0.42) / 0.02, 2));
        return val;
    },

    // Atrial fibrillation: irregular R-R intervals, no P waves, fibrillatory baseline
    ecgAFib(phase, time) {
        let val = 0;
        // No P wave, add fibrillatory baseline
        val += 0.03 * Math.sin(time * 25) + 0.02 * Math.sin(time * 37);
        // QRS complex (narrower, same morphology)
        val -= 0.07 * Math.exp(-Math.pow((phase - 0.19) / 0.007, 2));
        val += 0.85 * Math.exp(-Math.pow((phase - 0.20) / 0.008, 2));
        val -= 0.12 * Math.exp(-Math.pow((phase - 0.215) / 0.006, 2));
        // T wave
        val += 0.15 * Math.exp(-Math.pow((phase - 0.32) / 0.03, 2));
        return val;
    },

    // Ventricular tachycardia: wide QRS, no P waves
    ecgVTach(phase) {
        let val = 0;
        // Wide QRS complex
        val += 0.7 * Math.exp(-Math.pow((phase - 0.2) / 0.04, 2));
        val -= 0.5 * Math.exp(-Math.pow((phase - 0.28) / 0.03, 2));
        val += 0.3 * Math.exp(-Math.pow((phase - 0.35) / 0.04, 2));
        return val;
    },

    // Ventricular fibrillation: chaotic
    ecgVFib(time) {
        return 0.3 * Math.sin(time * 15.7) * Math.sin(time * 3.1)
             + 0.15 * Math.sin(time * 23.3)
             + 0.1 * Math.cos(time * 7.9);
    },

    // Asystole: flatline with slight drift
    ecgAsystole(time) {
        return 0.005 * Math.sin(time * 0.5);
    },

    // Sinus bradycardia: same morphology as normal, just slower rate
    ecgBrady(phase) {
        return Waveforms.ecgNormal(phase);
    },

    // Sinus tachycardia: same morphology as normal, just faster rate
    ecgTachy(phase) {
        return Waveforms.ecgNormal(phase);
    },

    // SpO2 plethysmography waveform
    spo2Pleth(phase) {
        if (phase < 0.35) {
            // Systolic upstroke and peak
            const t = phase / 0.35;
            return Math.pow(Math.sin(t * Math.PI / 2), 1.5);
        } else if (phase < 0.55) {
            // Dicrotic notch descent
            const t = (phase - 0.35) / 0.20;
            return 1.0 - 0.5 * t + 0.12 * Math.exp(-Math.pow((t - 0.5) / 0.15, 2));
        } else {
            // Diastolic descent
            const t = (phase - 0.55) / 0.45;
            return 0.5 * Math.exp(-2.5 * t);
        }
    },

    // Arterial blood pressure waveform
    abpWaveform(phase, systolic, diastolic) {
        const range = systolic - diastolic;
        let val;
        if (phase < 0.3) {
            // Systolic upstroke
            const t = phase / 0.3;
            val = diastolic + range * Math.pow(Math.sin(t * Math.PI / 2), 1.2);
        } else if (phase < 0.45) {
            // Dicrotic notch
            const t = (phase - 0.3) / 0.15;
            val = systolic - range * 0.25 * t + range * 0.08 * Math.exp(-Math.pow((t - 0.5) / 0.2, 2));
        } else {
            // Diastolic decay
            const t = (phase - 0.45) / 0.55;
            val = diastolic + range * 0.3 * Math.exp(-3.0 * t);
        }
        // Normalize to 0..1 for display
        return (val - diastolic + 10) / (range + 20);
    },

    // Capnography (EtCO2) waveform synchronized to respiratory rate
    capnography(phase) {
        if (phase < 0.05) {
            // Inspiratory baseline
            return 0;
        } else if (phase < 0.15) {
            // Expiratory upstroke
            const t = (phase - 0.05) / 0.1;
            return Math.pow(t, 0.5);
        } else if (phase < 0.45) {
            // Alveolar plateau
            const t = (phase - 0.15) / 0.3;
            return 0.95 + 0.05 * t;
        } else if (phase < 0.5) {
            // Inspiratory downstroke
            const t = (phase - 0.45) / 0.05;
            return 1.0 * (1 - Math.pow(t, 0.5));
        } else {
            // Inspiratory baseline
            return 0;
        }
    },

    // Respiration waveform (impedance pneumography)
    respiration(phase) {
        return 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI - Math.PI / 2);
    }
};

// ECG rhythm dispatcher with A-Fib irregularity support
class ECGGenerator {
    constructor() {
        this.rhythm = 'nsr';
        this.heartRate = 72;
        this.time = 0;
        this.beatPhase = 0;
        this.currentBeatDuration = 60.0 / this.heartRate;
        this.beatElapsed = 0;
        this.afibJitter = 0;
    }

    setRhythm(rhythm) {
        this.rhythm = rhythm;
    }

    setHeartRate(hr) {
        this.heartRate = hr;
    }

    nextSample(dt) {
        this.time += dt;
        this.beatElapsed += dt;

        // Always recalculate beat duration so HR changes take effect immediately
        const effectiveHR = Math.max(this.heartRate, 1);
        if (this.rhythm !== 'afib') {
            this.currentBeatDuration = 60.0 / effectiveHR;
        }

        if (this.beatElapsed >= this.currentBeatDuration) {
            this.beatElapsed = this.beatElapsed % this.currentBeatDuration;
            // A-Fib: randomize next beat duration
            if (this.rhythm === 'afib') {
                const base = 60.0 / effectiveHR;
                this.currentBeatDuration = base * (0.6 + Math.random() * 0.8);
            }
        }

        const phase = this.beatElapsed / this.currentBeatDuration;

        switch (this.rhythm) {
            case 'nsr': return Waveforms.ecgNormal(phase);
            case 'sinus_tachy': return Waveforms.ecgTachy(phase);
            case 'sinus_brady': return Waveforms.ecgBrady(phase);
            case 'afib': return Waveforms.ecgAFib(phase, this.time);
            case 'vtach': return Waveforms.ecgVTach(phase);
            case 'vfib': return Waveforms.ecgVFib(this.time);
            case 'asystole': return Waveforms.ecgAsystole(this.time);
            default: return Waveforms.ecgNormal(phase);
        }
    }

    getPhase() {
        return this.beatElapsed / this.currentBeatDuration;
    }
}
