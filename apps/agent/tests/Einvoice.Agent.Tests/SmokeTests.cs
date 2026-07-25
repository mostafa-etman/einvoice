using Einvoice.Agent;
using Xunit;

namespace Einvoice.Agent.Tests;

public class SmokeTests
{
    [Fact]
    public void Agent_assembly_loads()
    {
        var type = typeof(AgentEnv);
        Assert.Equal("Einvoice.Agent", type.Namespace);
    }
}
