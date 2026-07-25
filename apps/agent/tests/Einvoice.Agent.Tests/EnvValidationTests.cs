using Einvoice.Agent;
using Xunit;

namespace Einvoice.Agent.Tests;

public class EnvValidationTests
{
    [Fact]
    public void Load_succeeds_with_required_vars()
    {
        var result = AgentEnv.Load(new Dictionary<string, string?>
        {
            ["AGENT_ENVIRONMENT"] = "Development",
            ["ETA_BASE_URL"] = "https://api.preprod.invoicing.eta.gov.eg",
        });

        Assert.Equal("Development", result.Environment);
    }

    [Fact]
    public void Load_fails_fast_when_required_var_missing()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            AgentEnv.Load(new Dictionary<string, string?>
            {
                ["AGENT_ENVIRONMENT"] = "Development",
            }));

        Assert.Contains("ETA_BASE_URL", ex.Message);
    }
}
