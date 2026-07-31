using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent.Security;

/// <summary>
/// Ensures the eSeal PIN never appears in logs or cloud-bound payloads.
/// </summary>
public static class PinGuard
{
    private static readonly string[] ForbiddenKeys =
    [
        "pin",
        "tokenPin",
        "token_pin",
        "esealPin",
        "eSealPin",
        "password",
        "userPin",
        "cku_user_pin",
    ];

    /// <summary>Redact sequences that look like a known PIN from diagnostic text.</summary>
    public static string Redact(string? text, string? knownPin = null)
    {
        if (string.IsNullOrEmpty(text))
            return text ?? "";

        var result = text;
        if (!string.IsNullOrEmpty(knownPin) && knownPin.Length >= 4)
            result = result.Replace(knownPin, "[REDACTED_PIN]", StringComparison.Ordinal);

        result = Regex.Replace(
            result,
            @"(?i)(pin|password)\s*[=:]\s*\S+",
            "$1=[REDACTED]");
        return result;
    }

    /// <summary>
    /// Throws if a JSON body destined for the cloud contains PIN-like keys or values.
    /// Call before every agent→API write.
    /// </summary>
    public static void AssertNoPinInPayload(JToken? body, string? knownPin = null)
    {
        if (body is null) return;
        Walk(body, knownPin);
    }

    private static void Walk(JToken token, string? knownPin)
    {
        switch (token.Type)
        {
            case JTokenType.Object:
                foreach (var prop in ((JObject)token).Properties())
                {
                    if (ForbiddenKeys.Any(k =>
                            string.Equals(k, prop.Name, StringComparison.OrdinalIgnoreCase)))
                    {
                        throw new InvalidOperationException(
                            $"Refusing to send PIN-related field '{prop.Name}' to the cloud.");
                    }

                    Walk(prop.Value, knownPin);
                }
                break;
            case JTokenType.Array:
                foreach (var child in (JArray)token)
                    Walk(child, knownPin);
                break;
            case JTokenType.String:
                var s = token.Value<string>();
                if (!string.IsNullOrEmpty(knownPin)
                    && knownPin.Length >= 4
                    && s is not null
                    && s.Contains(knownPin, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "Refusing to send payload that embeds the eSeal PIN.");
                }
                break;
        }
    }
}
