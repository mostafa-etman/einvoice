using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Einvoice.Agent.Config;

/// <summary>
/// Long-lived pairing record stored under %LocalAppData%\Einvoice.Agent.
/// The device token is DPAPI-protected on Windows (CurrentUser). The eSeal PIN
/// is never stored here (see <see cref="PinVault"/>).
/// </summary>
public sealed class PersistedPairing
{
    public string DeviceToken { get; init; } = "";
    public string? DeviceId { get; init; }
    public string? TenantId { get; init; }
    public string? ApiBaseUrl { get; init; }
    public string? DeviceLabel { get; init; }
    public DateTimeOffset PairedAtUtc { get; init; } = DateTimeOffset.UtcNow;

    public bool IsValid => !string.IsNullOrWhiteSpace(DeviceToken);
}

/// <summary>Persists device pairing credentials (not the eSeal PIN).</summary>
public static class DeviceTokenStore
{
    public const string PairingFileName = "pairing.json";
    public const string LegacyTokenFileName = "device.token";

    private const string EnvelopeVersion = "1";
    private const string DpapiEntropy = "Einvoice.Agent.DeviceToken.v1";
    private static readonly Regex DeviceTokenShape = new(
        @"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]+$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string DefaultDirectory => LocalAgentConfig.DefaultDirectory;

    public static string DefaultPairingPath => Path.Combine(DefaultDirectory, PairingFileName);

    public static string DefaultLegacyPath => Path.Combine(DefaultDirectory, LegacyTokenFileName);

    public static void SavePairing(PersistedPairing pairing, string? path = null)
    {
        ArgumentNullException.ThrowIfNull(pairing);
        if (string.IsNullOrWhiteSpace(pairing.DeviceToken))
            throw new ArgumentException("Device token is required.", nameof(pairing));

        path ??= DefaultPairingPath;
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var (protection, cipher) = ProtectToken(pairing.DeviceToken.Trim());
        var envelope = new PairingEnvelope
        {
            Version = EnvelopeVersion,
            DeviceId = pairing.DeviceId,
            TenantId = pairing.TenantId,
            ApiBaseUrl = pairing.ApiBaseUrl,
            DeviceLabel = pairing.DeviceLabel,
            PairedAtUtc = pairing.PairedAtUtc == default ? DateTimeOffset.UtcNow : pairing.PairedAtUtc,
            Protection = protection,
            TokenProtectedBase64 = cipher,
        };

        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(envelope, JsonOpts));
        File.Copy(tmp, path, overwrite: true);
        File.Delete(tmp);

        // Drop a same-folder legacy blob so Load cannot pick a stale token.
        var folder = dir ?? DefaultDirectory;
        var savedName = Path.GetFileName(path);
        if (!string.Equals(savedName, LegacyTokenFileName, StringComparison.OrdinalIgnoreCase))
            TryDelete(Path.Combine(folder, LegacyTokenFileName));
    }

    public static PersistedPairing? LoadPairing(string? path = null, string? legacyTokenPath = null)
    {
        path ??= DefaultPairingPath;
        legacyTokenPath ??= DefaultLegacyPath;

        var fromEnvelope = TryLoadEnvelope(path);
        if (fromEnvelope is { IsValid: true })
            return fromEnvelope;

        var legacy = TryLoadLegacyToken(legacyTokenPath);
        if (legacy is null)
            return null;

        var migrated = new PersistedPairing
        {
            DeviceToken = legacy,
            PairedAtUtc = DateTimeOffset.UtcNow,
        };
        try
        {
            SavePairing(migrated, path);
        }
        catch
        {
            // Still return the token so this launch is paired even if migrate fails.
        }

        return migrated;
    }

    /// <summary>Legacy API: persist only the bearer token (DPAPI on Windows).</summary>
    public static void Save(string path, string deviceToken)
    {
        SavePairing(new PersistedPairing { DeviceToken = deviceToken, PairedAtUtc = DateTimeOffset.UtcNow }, path);
    }

    /// <summary>Legacy API: load a pairing file or old <c>device.token</c> blob.</summary>
    public static string? Load(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var dir = Path.GetDirectoryName(path);
        var name = Path.GetFileName(path);
        if (string.Equals(name, LegacyTokenFileName, StringComparison.OrdinalIgnoreCase))
        {
            var pairingPath = Path.Combine(dir ?? DefaultDirectory, PairingFileName);
            return LoadPairing(pairingPath, path)?.DeviceToken;
        }

        return LoadPairing(path, Path.Combine(dir ?? DefaultDirectory, LegacyTokenFileName))?.DeviceToken;
    }

    public static void Clear(string? path = null, string? legacyTokenPath = null)
    {
        TryDelete(path ?? DefaultPairingPath);
        TryDelete(legacyTokenPath ?? DefaultLegacyPath);
        if (path is not null)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
                TryDelete(Path.Combine(dir, LegacyTokenFileName));
        }
    }

    private static PersistedPairing? TryLoadEnvelope(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            var json = File.ReadAllText(path);
            if (string.IsNullOrWhiteSpace(json) || json.TrimStart()[0] != '{')
                return TryParseRawTokenFile(path);

            var envelope = JsonSerializer.Deserialize<PairingEnvelope>(json, JsonOpts);
            if (envelope is null || string.IsNullOrWhiteSpace(envelope.TokenProtectedBase64))
                return null;

            var token = UnprotectToken(envelope.Protection, envelope.TokenProtectedBase64);
            if (string.IsNullOrWhiteSpace(token))
                return null;

            return new PersistedPairing
            {
                DeviceToken = token.Trim(),
                DeviceId = envelope.DeviceId,
                TenantId = envelope.TenantId,
                ApiBaseUrl = envelope.ApiBaseUrl,
                DeviceLabel = envelope.DeviceLabel,
                PairedAtUtc = envelope.PairedAtUtc ?? DateTimeOffset.UtcNow,
            };
        }
        catch
        {
            return null;
        }
    }

    private static string? TryLoadLegacyToken(string path)
    {
        if (!File.Exists(path)) return null;
        try
        {
            var bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0) return null;

            // Envelope accidentally stored at the legacy path.
            if (bytes[0] == (byte)'{')
                return TryLoadEnvelope(path)?.DeviceToken;

            if (OperatingSystem.IsWindows())
            {
                foreach (var entropy in new byte[][]
                         {
                             Encoding.UTF8.GetBytes(DpapiEntropy),
                             [],
                         })
                {
                    try
                    {
                        var plain = ProtectedData.Unprotect(
                            bytes,
                            optionalEntropy: entropy.Length == 0 ? null : entropy,
                            scope: DataProtectionScope.CurrentUser);
                        var text = Encoding.UTF8.GetString(plain).Trim();
                        if (LooksLikeDeviceToken(text))
                            return text;
                    }
                    catch
                    {
                        // Try next entropy / plaintext.
                    }
                }
            }

            var asText = Encoding.UTF8.GetString(bytes).Trim().Trim('\0');
            return LooksLikeDeviceToken(asText) ? asText : null;
        }
        catch
        {
            return null;
        }
    }

    private static PersistedPairing? TryParseRawTokenFile(string path)
    {
        var token = TryLoadLegacyToken(path);
        return token is null
            ? null
            : new PersistedPairing { DeviceToken = token, PairedAtUtc = DateTimeOffset.UtcNow };
    }

    private static (string protection, string cipherBase64) ProtectToken(string token)
    {
        var plain = Encoding.UTF8.GetBytes(token);
        try
        {
            if (OperatingSystem.IsWindows())
            {
                var protectedBytes = ProtectedData.Protect(
                    plain,
                    optionalEntropy: Encoding.UTF8.GetBytes(DpapiEntropy),
                    scope: DataProtectionScope.CurrentUser);
                return ("dpapi", Convert.ToBase64String(protectedBytes));
            }
        }
        catch
        {
            // Fall through to base64 (still local-disk only; PIN is never stored here).
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }

        return ("none", Convert.ToBase64String(Encoding.UTF8.GetBytes(token)));
    }

    private static string? UnprotectToken(string? protection, string cipherBase64)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(cipherBase64);
        }
        catch
        {
            return null;
        }

        if (string.Equals(protection, "dpapi", StringComparison.OrdinalIgnoreCase)
            && OperatingSystem.IsWindows())
        {
            try
            {
                var plain = ProtectedData.Unprotect(
                    bytes,
                    optionalEntropy: Encoding.UTF8.GetBytes(DpapiEntropy),
                    scope: DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(plain);
            }
            catch
            {
                return null;
            }
        }

        return Encoding.UTF8.GetString(bytes);
    }

    private static bool LooksLikeDeviceToken(string text) =>
        !string.IsNullOrWhiteSpace(text) && DeviceTokenShape.IsMatch(text.Trim());

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch
        {
            /* ignore */
        }
    }

    private sealed class PairingEnvelope
    {
        public string Version { get; set; } = EnvelopeVersion;
        public string? DeviceId { get; set; }
        public string? TenantId { get; set; }
        public string? ApiBaseUrl { get; set; }
        public string? DeviceLabel { get; set; }
        public DateTimeOffset? PairedAtUtc { get; set; }
        public string Protection { get; set; } = "dpapi";
        public string TokenProtectedBase64 { get; set; } = "";
    }
}
