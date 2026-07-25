namespace Einvoice.Agent;

public static class AgentEnv
{
    public static (string Environment, string EtaBaseUrl) Load(IDictionary<string, string?> env)
    {
        var missing = new List<string>();

        if (!env.TryGetValue("AGENT_ENVIRONMENT", out var environment) || string.IsNullOrWhiteSpace(environment))
        {
            missing.Add("AGENT_ENVIRONMENT");
        }

        if (!env.TryGetValue("ETA_BASE_URL", out var etaBaseUrl) || string.IsNullOrWhiteSpace(etaBaseUrl))
        {
            missing.Add("ETA_BASE_URL");
        }

        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                $"Invalid environment configuration: missing required variable(s): {string.Join(", ", missing)}");
        }

        return (environment!, etaBaseUrl!);
    }

    public static IDictionary<string, string?> FromProcess()
    {
        return new Dictionary<string, string?>
        {
            ["AGENT_ENVIRONMENT"] = Environment.GetEnvironmentVariable("AGENT_ENVIRONMENT"),
            ["ETA_BASE_URL"] = Environment.GetEnvironmentVariable("ETA_BASE_URL"),
        };
    }
}
