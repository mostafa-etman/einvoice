using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Einvoice.Agent.Platform;

namespace Einvoice.Agent.Config;

/// <summary>
/// Optional local PIN cache. Ciphertext is DPAPI-protected on Windows and
/// Keychain-wrapped on macOS. Never syncs to the cloud. Disabled unless the
/// user explicitly opts in.
/// </summary>
public static class PinVault
{
    public static string FileName =>
        OperatingSystem.IsWindows() ? "pin.dpapi" : "pin.vault.json";

    public static string DefaultPath =>
        Path.Combine(LocalAgentConfig.DefaultDirectory, FileName);

    private const string Purpose = "Einvoice.Agent.PinVault.v1";

    private sealed class Envelope
    {
        public DateTimeOffset ExpiresUtc { get; set; }
        public string CipherBase64 { get; set; } = "";
        public string Protection { get; set; } = LocalSecretProtector.DpapiProtection;
    }

    public static void Save(
        string pin,
        TimeSpan lifetime,
        string? path = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(pin);

        path ??= DefaultPath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        var plain = Encoding.UTF8.GetBytes(pin);
        try
        {
            var (protection, cipher) = LocalSecretProtector.Protect(plain, Purpose);

            var expires = lifetime <= TimeSpan.Zero
                ? DateTimeOffset.MaxValue
                : DateTimeOffset.UtcNow.Add(lifetime);

            var envelope = new Envelope
            {
                ExpiresUtc = expires,
                CipherBase64 = cipher,
                Protection = protection,
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
        if (!File.Exists(path))
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

            var plain = LocalSecretProtector.Unprotect(
                string.IsNullOrWhiteSpace(envelope.Protection)
                    ? LocalSecretProtector.DpapiProtection
                    : envelope.Protection,
                envelope.CipherBase64,
                Purpose);
            if (plain is null)
                return null;
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
