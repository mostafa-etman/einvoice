using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Einvoice.Agent.Config;

/// <summary>
/// Optional local PIN cache. PIN ciphertext is DPAPI-protected
/// (<see cref="DataProtectionScope.CurrentUser"/>) — bound to the Windows user+machine.
/// Never syncs to the cloud. Disabled unless the user explicitly opts in.
/// </summary>
public static class PinVault
{
    public const string FileName = "pin.dpapi";

    public static string DefaultPath =>
        Path.Combine(LocalAgentConfig.DefaultDirectory, FileName);

    private sealed class Envelope
    {
        public DateTimeOffset ExpiresUtc { get; set; }
        public string CipherBase64 { get; set; } = "";
    }

    public static void Save(
        string pin,
        TimeSpan lifetime,
        string? path = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(pin);
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("PIN remember requires Windows DPAPI.");

        path ??= DefaultPath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        var plain = Encoding.UTF8.GetBytes(pin);
        try
        {
            var protectedBytes = ProtectedData.Protect(
                plain,
                optionalEntropy: Encoding.UTF8.GetBytes("Einvoice.Agent.PinVault.v1"),
                scope: DataProtectionScope.CurrentUser);

            var expires = lifetime <= TimeSpan.Zero
                ? DateTimeOffset.MaxValue
                : DateTimeOffset.UtcNow.Add(lifetime);

            var envelope = new Envelope
            {
                ExpiresUtc = expires,
                CipherBase64 = Convert.ToBase64String(protectedBytes),
            };
            File.WriteAllText(path, JsonSerializer.Serialize(envelope));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    public static string? TryLoad(string? path = null)
    {
        path ??= DefaultPath;
        if (!File.Exists(path) || !OperatingSystem.IsWindows())
            return null;

        try
        {
            var envelope = JsonSerializer.Deserialize<Envelope>(File.ReadAllText(path));
            if (envelope is null || string.IsNullOrWhiteSpace(envelope.CipherBase64))
                return null;

            if (DateTimeOffset.UtcNow >= envelope.ExpiresUtc)
            {
                Clear(path);
                return null;
            }

            var protectedBytes = Convert.FromBase64String(envelope.CipherBase64);
            var plain = ProtectedData.Unprotect(
                protectedBytes,
                optionalEntropy: Encoding.UTF8.GetBytes("Einvoice.Agent.PinVault.v1"),
                scope: DataProtectionScope.CurrentUser);
            try
            {
                return Encoding.UTF8.GetString(plain);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
        catch
        {
            Clear(path);
            return null;
        }
    }

    public static void Clear(string? path = null)
    {
        path ??= DefaultPath;
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            /* ignore */
        }
    }
}
