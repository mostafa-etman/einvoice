using System.Text;

namespace Einvoice.Agent.Config;

/// <summary>Persists device token under LocalAppData (DPAPI on Windows when available).</summary>
public static class DeviceTokenStore
{
    public static void Save(string path, string deviceToken)
    {
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        var bytes = Encoding.UTF8.GetBytes(deviceToken);
        try
        {
            if (OperatingSystem.IsWindows())
            {
                bytes = System.Security.Cryptography.ProtectedData.Protect(
                    bytes,
                    optionalEntropy: null,
                    scope: System.Security.Cryptography.DataProtectionScope.CurrentUser);
            }
        }
        catch
        {
            // Fall through to plaintext file if DPAPI unavailable.
        }

        File.WriteAllBytes(path, bytes);
    }

    public static string? Load(string path)
    {
        if (!File.Exists(path)) return null;
        var bytes = File.ReadAllBytes(path);
        try
        {
            if (OperatingSystem.IsWindows())
            {
                bytes = System.Security.Cryptography.ProtectedData.Unprotect(
                    bytes,
                    optionalEntropy: null,
                    scope: System.Security.Cryptography.DataProtectionScope.CurrentUser);
            }
        }
        catch
        {
            // Treat as plaintext.
        }

        return Encoding.UTF8.GetString(bytes);
    }

    public static void Clear(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }
}
