namespace Einvoice.Agent.Config;

/// <summary>
/// Local pairing must track cloud revoke. After admin/web unpair the next
/// agent call is 401 — drop the saved token so Pair is available again.
/// </summary>
public static class PairingLifecycle
{
    public static bool MustDropLocalPairing(bool tokenRejectedByServer, bool hasLocalDeviceToken) =>
        tokenRejectedByServer && hasLocalDeviceToken;
}
