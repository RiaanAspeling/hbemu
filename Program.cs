using HBEmu.Hubs;
using HBEmu.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();
builder.Services.AddSingleton<SessionManager>();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapHub<VitalsHub>("/vitalsHub");

app.MapGet("/", () => Results.Redirect("/monitor/"));

app.Run();
