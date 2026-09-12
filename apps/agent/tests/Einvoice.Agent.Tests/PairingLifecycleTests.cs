using Einvoice.Agent.Config;
using Xunit;

namespace Einvoice.Agent.Tests;

public class PairingLifecycleTests
{
    [Fact]
    public void Drops_local_pairing_when_the_server_rejects_the_token()
    {
        Assert.True(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: true, hasLocalDeviceToken: true));
    }

    [Fact]
    public void Keeps_local_pairing_while_the_token_is_still_accepted()
    {
        Assert.False(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: false, hasLocalDeviceToken: true));
    }

    [Fact]
    public void Does_nothing_when_already_unpaired_locally()
    {
        Assert.False(PairingLifecycle.MustDropLocalPairing(tokenRejectedByServer: true, hasLocalDeviceToken: false));
    }
}
