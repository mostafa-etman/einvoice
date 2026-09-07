using Einvoice.Agent.Config;
using Xunit;

namespace Einvoice.Agent.Tests;

public class DeviceTokenStoreTests
{
    private static string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "einvoice-pairing-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return dir;
    }

    [Fact]
    public void SavePairing_roundtrip_restores_token_and_binding_without_pin()
    {
        var dir = TempDir();
        try
        {
            var path = Path.Combine(dir, DeviceTokenStore.PairingFileName);
            var token =
                $"{Guid.NewGuid():D}.{Guid.NewGuid():D}.{Convert.ToHexString(RandomNumberHelper.Bytes(32)).ToLowerInvariant()}";
            var pairing = new PersistedPairing
            {
                DeviceToken = token,
                DeviceId = Guid.NewGuid().ToString("D"),
                TenantId = Guid.NewGuid().ToString("D"),
                ApiBaseUrl = "https://etaapi.erp-esafe.com",
                DeviceLabel = "Accounts PC",
                PairedAtUtc = DateTimeOffset.UtcNow,
            };

            DeviceTokenStore.SavePairing(pairing, path);
            Assert.True(File.Exists(path));

            var json = File.ReadAllText(path);
            Assert.DoesNotContain("\"pin\"", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(token, json, StringComparison.Ordinal);

            var loaded = DeviceTokenStore.LoadPairing(path, Path.Combine(dir, DeviceTokenStore.LegacyTokenFileName));
            Assert.NotNull(loaded);
            Assert.Equal(token, loaded!.DeviceToken);
            Assert.Equal(pairing.DeviceId, loaded.DeviceId);
            Assert.Equal(pairing.TenantId, loaded.TenantId);
            Assert.Equal(pairing.ApiBaseUrl, loaded.ApiBaseUrl);
            Assert.Equal(pairing.DeviceLabel, loaded.DeviceLabel);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void LoadPairing_migrates_legacy_plaintext_device_token()
    {
        var dir = TempDir();
        try
        {
            var pairingPath = Path.Combine(dir, DeviceTokenStore.PairingFileName);
            var legacyPath = Path.Combine(dir, DeviceTokenStore.LegacyTokenFileName);
            var token =
                $"{Guid.NewGuid():D}.{Guid.NewGuid():D}.{Convert.ToHexString(RandomNumberHelper.Bytes(16)).ToLowerInvariant()}";
            File.WriteAllText(legacyPath, token);

            var loaded = DeviceTokenStore.LoadPairing(pairingPath, legacyPath);
            Assert.Equal(token, loaded?.DeviceToken);
            Assert.True(File.Exists(pairingPath));

            var again = DeviceTokenStore.LoadPairing(pairingPath, legacyPath);
            Assert.Equal(token, again?.DeviceToken);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Load_does_not_treat_random_bytes_as_a_token()
    {
        var dir = TempDir();
        try
        {
            var legacyPath = Path.Combine(dir, DeviceTokenStore.LegacyTokenFileName);
            File.WriteAllBytes(legacyPath, Enumerable.Range(0, 64).Select(i => (byte)i).ToArray());

            var loaded = DeviceTokenStore.LoadPairing(
                Path.Combine(dir, DeviceTokenStore.PairingFileName),
                legacyPath);
            Assert.Null(loaded);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Clear_removes_pairing_so_next_load_is_empty()
    {
        var dir = TempDir();
        try
        {
            var path = Path.Combine(dir, DeviceTokenStore.PairingFileName);
            var token =
                $"{Guid.NewGuid():D}.{Guid.NewGuid():D}.{Convert.ToHexString(RandomNumberHelper.Bytes(8)).ToLowerInvariant()}";
            DeviceTokenStore.SavePairing(new PersistedPairing { DeviceToken = token }, path);
            DeviceTokenStore.Clear(path, Path.Combine(dir, DeviceTokenStore.LegacyTokenFileName));
            Assert.Null(DeviceTokenStore.LoadPairing(path, Path.Combine(dir, DeviceTokenStore.LegacyTokenFileName)));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void DefaultDirectory_is_localappdata_not_cwd_or_basedirectory()
    {
        var dir = LocalAgentConfig.DefaultDirectory;
        Assert.Contains("Einvoice.Agent", dir, StringComparison.Ordinal);
        Assert.False(dir.StartsWith(AppContext.BaseDirectory, StringComparison.OrdinalIgnoreCase));
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!string.IsNullOrWhiteSpace(local))
            Assert.StartsWith(local, dir, StringComparison.OrdinalIgnoreCase);
    }
}

internal static class RandomNumberHelper
{
    public static byte[] Bytes(int count)
    {
        var b = new byte[count];
        Random.Shared.NextBytes(b);
        return b;
    }
}
