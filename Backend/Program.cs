// import packages
using System.ComponentModel;
using System.Text.Json.Serialization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

// values from OpenAI deployment
var modelId = "gpt-4o-mini";
var endpoint = "";
var apiKey = "";

// app builder
var webBuilder = WebApplication.CreateBuilder(args);

// Set the port explicitly
webBuilder.WebHost.UseUrls("http://localhost:5000");

// Controllers
webBuilder.Services.AddControllers();

// CORS (Angular dev server)
webBuilder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:4200")
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials());
});

// Semantic Kernel + dependencies in DI
webBuilder.Services.AddSingleton(_ =>
{
    var kb = Kernel.CreateBuilder()
        .AddAzureOpenAIChatCompletion(modelId, endpoint, apiKey);

    kb.Services.AddLogging(lb => lb.AddConsole().SetMinimumLevel(LogLevel.Trace));

    var kernel = kb.Build();
    kernel.Plugins.AddFromType<VMsPlugin>("VMs");
    return kernel;
});

webBuilder.Services.AddSingleton(sp =>
    sp.GetRequiredService<Kernel>().GetRequiredService<IChatCompletionService>());

webBuilder.Services.AddSingleton(new OpenAIPromptExecutionSettings
{
    FunctionChoiceBehavior = FunctionChoiceBehavior.Auto()
});

var app = webBuilder.Build();

app.UseCors();

// Map controller endpoints: /api/chat, /api/chat/stream
app.MapControllers();

// Keep VM REST endpoint (optional)
app.MapGet("/api/vms", () => Results.Ok(VMsPlugin.MockData));

app.Run();

public class VMsPlugin
{
    internal static readonly List<VmModel> MockData = new()
    {
        new VmModel
        {
            Id = 101, Name = "DEV-W11-01", Os = "Windows 11 Enterprise", OsVersion = "23H2",
            PowerState = "running", CpuCores = 4, MemoryGb = 16, DiskGb = 256, IpAddress = "10.10.1.21",
            Owner = "dev-team", Environment = "dev", Tags = new[] { "windows", "w11", "frontend" },
            LastBootUtc = DateTimeOffset.UtcNow.AddHours(-6), Notes = "Primary Windows 11 dev box."
        },
        new VmModel
        {
            Id = 102, Name = "QA-W11-EDGE", Os = "Windows 11 Pro", OsVersion = "22H2",
            PowerState = "stopped", CpuCores = 2, MemoryGb = 8, DiskGb = 128, IpAddress = null,
            Owner = "qa-team", Environment = "qa", Tags = new[] { "windows", "w11", "edge" },
            LastBootUtc = DateTimeOffset.UtcNow.AddDays(-2), Notes = "Used for Edge regression."
        },
    };

    private readonly List<VmModel> _vms = MockData;

    [KernelFunction("get_vms")]
    [Description("Gets a list of virtual machines and their current power state, OS, and key details.")]
    public Task<List<VmModel>> GetVmsAsync() => Task.FromResult(_vms);

    [KernelFunction("get_vm")]
    [Description("Gets details for a single virtual machine by id.")]
    public Task<VmModel?> GetVmAsync(int id) => Task.FromResult(_vms.FirstOrDefault(v => v.Id == id));

    [KernelFunction("change_power_state")]
    [Description("Changes the VM power state. Valid values: running, stopped, suspended.")]
    public Task<VmModel?> ChangePowerStateAsync(int id, string powerState)
    {
        var vm = _vms.FirstOrDefault(v => v.Id == id);
        if (vm is null) return Task.FromResult<VmModel?>(null);

        var normalized = (powerState ?? string.Empty).Trim().ToLowerInvariant();
        if (normalized is not ("running" or "stopped" or "suspended"))
            return Task.FromResult<VmModel?>(vm);

        vm.PowerState = normalized;
        vm.IpAddress = normalized == "running" ? (vm.IpAddress ?? "10.10.99.99") : null;

        return Task.FromResult<VmModel?>(vm);
    }
}

public class VmModel
{
    [JsonPropertyName("id")]
    public int Id { get; set; }

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("os")]
    public string Os { get; set; } = string.Empty;

    [JsonPropertyName("os_version")]
    public string OsVersion { get; set; } = string.Empty;

    [JsonPropertyName("power_state")]
    public string PowerState { get; set; } = "stopped";

    [JsonPropertyName("cpu_cores")]
    public int CpuCores { get; set; }

    [JsonPropertyName("memory_gb")]
    public int MemoryGb { get; set; }

    [JsonPropertyName("disk_gb")]
    public int DiskGb { get; set; }

    [JsonPropertyName("ip_address")]
    public string? IpAddress { get; set; }

    [JsonPropertyName("owner")]
    public string Owner { get; set; } = string.Empty;

    [JsonPropertyName("environment")]
    public string Environment { get; set; } = string.Empty;

    [JsonPropertyName("tags")]
    public string[] Tags { get; set; } = Array.Empty<string>();

    [JsonPropertyName("last_boot_utc")]
    public DateTimeOffset? LastBootUtc { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}