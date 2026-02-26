using Microsoft.AspNetCore.Mvc;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;

namespace MyLightsApp.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly Kernel _kernel;
    private readonly IChatCompletionService _chat;
    private readonly OpenAIPromptExecutionSettings _settings;

    public ChatController(
        Kernel kernel,
        IChatCompletionService chat,
        OpenAIPromptExecutionSettings settings)
    {
        _kernel = kernel;
        _chat = chat;
        _settings = settings;
    }

    public sealed class ChatRequest
    {
        public string Message { get; set; } = string.Empty;
        public List<ChatMessageDto> History { get; set; } = new();
    }
    
    public sealed class ChatMessageDto
    {
        public string Role { get; set; } = string.Empty;  // "user" | "assistant"
        public string Content { get; set; } = string.Empty;
    }

    [HttpPost]
    public async Task<ActionResult<object>> Chat([FromBody] ChatRequest request)
    {
        var history = ToChatHistory(request);
        var result = await _chat.GetChatMessageContentAsync(history, _settings, _kernel);

        return Ok(new { role = "assistant", content = result.Content ?? string.Empty });
    }

    [HttpPost("stream")]
    public async Task StreamChat([FromBody] ChatRequest request)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        var history = ToChatHistory(request);

        try
        {
            await foreach (var chunk in _chat.GetStreamingChatMessageContentsAsync(history, _settings, _kernel))
            {
                if (!string.IsNullOrWhiteSpace(chunk.Content))
                {
                    await Response.WriteAsync($"data: {chunk.Content}\n\n");
                    await Response.Body.FlushAsync();
                }
            }
        }
        catch (Exception ex)
        {
            await Response.WriteAsync($"data: [Error: {ex.Message}]\n\n");
            await Response.Body.FlushAsync();
        }

        await Response.WriteAsync("data: [DONE]\n\n");
        await Response.Body.FlushAsync();
    }

    private static ChatHistory ToChatHistory(ChatRequest request)
    {
        var history = new ChatHistory();

        foreach (var msg in request.History)
        {
            if (string.Equals(msg.Role, "user", StringComparison.OrdinalIgnoreCase))
                history.AddUserMessage(msg.Content);
            else
                history.AddAssistantMessage(msg.Content);
        }

        history.AddUserMessage(request.Message);
        return history;
    }
}
