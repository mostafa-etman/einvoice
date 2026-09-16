using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Einvoice.Agent.Platform;

/// <summary>
/// OS-bound wrapping of small secrets. Windows = DPAPI CurrentUser; macOS = AES-GCM
/// keyed from the login Keychain. The eSeal PIN is never sent to the cloud.
/// </summary>
internal static class LocalSecretProtector
{
    internal const string MacosKeychainProtection = "macos-keychain";
    internal const string DpapiProtection = "dpapi";
    internal const string NoneProtection = "none";

    public static (string Protection, string CipherBase64) Protect(byte[] plain, string purpose)
    {
        ArgumentNullException.ThrowIfNull(plain);
        ArgumentException.ThrowIfNullOrWhiteSpace(purpose);

        if (OperatingSystem.IsWindows())
        {
            var protectedBytes = ProtectedData.Protect(
                plain,
                optionalEntropy: Encoding.UTF8.GetBytes(purpose),
                scope: DataProtectionScope.CurrentUser);
            return (DpapiProtection, Convert.ToBase64String(protectedBytes));
        }

        if (OperatingSystem.IsMacOS())
        {
            var wrapped = MacOsKeychain.Wrap(plain, purpose);
            return (MacosKeychainProtection, Convert.ToBase64String(wrapped));
        }

        return (NoneProtection, Convert.ToBase64String(plain));
    }

    public static byte[]? Unprotect(string? protection, string cipherBase64, string purpose)
    {
        if (string.IsNullOrWhiteSpace(cipherBase64))
            return null;

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(cipherBase64);
        }
        catch
        {
            return null;
        }

        if (string.Equals(protection, DpapiProtection, StringComparison.OrdinalIgnoreCase)
            && OperatingSystem.IsWindows())
        {
            try
            {
                return ProtectedData.Unprotect(
                    bytes,
                    optionalEntropy: Encoding.UTF8.GetBytes(purpose),
                    scope: DataProtectionScope.CurrentUser);
            }
            catch
            {
                return null;
            }
        }

        if (string.Equals(protection, MacosKeychainProtection, StringComparison.OrdinalIgnoreCase)
            && OperatingSystem.IsMacOS())
        {
            try
            {
                return MacOsKeychain.Unwrap(bytes, purpose);
            }
            catch
            {
                return null;
            }
        }

        if (string.Equals(protection, NoneProtection, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(protection))
            return bytes;

        return null;
    }
}

/// <summary>
/// Stores a 256-bit wrap key as a generic password in the login keychain, then
/// AES-GCM-encrypts pairing/PIN blobs on disk.
/// </summary>
internal static class MacOsKeychain
{
    private const string SecurityPath = "/System/Library/Frameworks/Security.framework/Security";
    private const string CoreFoundationPath = "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation";
    private const string Service = "com.einvoice.agent";
    private const uint Utf8 = 0x08000100;
    private const int ErrSecSuccess = 0;
    private const int ErrSecItemNotFound = -25300;
    private const int ErrSecDuplicateItem = -25299;
    private const int GcmNonceSize = 12;
    private const int GcmTagSize = 16;
    private const byte WrapVersion = 1;

    public static byte[] Wrap(byte[] plain, string purpose)
    {
        var key = GetOrCreateWrapKey(purpose);
        var nonce = RandomNumberGenerator.GetBytes(GcmNonceSize);
        var cipher = new byte[plain.Length];
        var tag = new byte[GcmTagSize];
        using (var gcm = new AesGcm(key, tagSizeInBytes: 16))
            gcm.Encrypt(nonce, plain, cipher, tag);

        var packed = new byte[1 + GcmNonceSize + GcmTagSize + cipher.Length];
        packed[0] = WrapVersion;
        Buffer.BlockCopy(nonce, 0, packed, 1, GcmNonceSize);
        Buffer.BlockCopy(tag, 0, packed, 1 + GcmNonceSize, GcmTagSize);
        Buffer.BlockCopy(cipher, 0, packed, 1 + GcmNonceSize + GcmTagSize, cipher.Length);
        CryptographicOperations.ZeroMemory(key);
        return packed;
    }

    public static byte[] Unwrap(byte[] packed, string purpose)
    {
        if (packed.Length < 1 + GcmNonceSize + GcmTagSize + 1 || packed[0] != WrapVersion)
            throw new CryptographicException("Invalid macOS keychain wrap.");

        var nonce = packed.AsSpan(1, GcmNonceSize);
        var tag = packed.AsSpan(1 + GcmNonceSize, GcmTagSize);
        var cipher = packed.AsSpan(1 + GcmNonceSize + GcmTagSize);
        var plain = new byte[cipher.Length];
        var key = GetOrCreateWrapKey(purpose);
        try
        {
            using var gcm = new AesGcm(key, tagSizeInBytes: 16);
            gcm.Decrypt(nonce, cipher, tag, plain);
            return plain;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }

    private static byte[] GetOrCreateWrapKey(string purpose)
    {
        if (!OperatingSystem.IsMacOS())
            throw new PlatformNotSupportedException("Keychain wrap is macOS-only.");

        var account = "wrap-v1:" + purpose;
        var existing = TryGet(account);
        if (existing is { Length: 32 })
            return existing;

        var key = RandomNumberGenerator.GetBytes(32);
        Set(account, key);
        return key;
    }

    private static byte[]? TryGet(string account)
    {
        var api = SecApi.Load();
        var service = api.CreateString(Service);
        var acc = api.CreateString(account);
        IntPtr dict = IntPtr.Zero;
        try
        {
            dict = api.CreateQuery(service, acc, returnData: true);
            var status = api.CopyMatching(dict, out var found);
            if (status == ErrSecItemNotFound || found == IntPtr.Zero)
                return null;
            if (status != ErrSecSuccess)
                throw new InvalidOperationException($"SecItemCopyMatching status={status}");
            try
            {
                return api.CfDataToBytes(found);
            }
            finally
            {
                api.Release(found);
            }
        }
        finally
        {
            api.Release(dict);
            api.Release(service);
            api.Release(acc);
        }
    }

    private static void Set(string account, byte[] data)
    {
        var api = SecApi.Load();
        var service = api.CreateString(Service);
        var acc = api.CreateString(account);
        var value = api.CreateData(data);
        IntPtr add = IntPtr.Zero;
        try
        {
            add = api.CreateAdd(service, acc, value);
            var status = api.Add(add);
            if (status == ErrSecDuplicateItem)
            {
                Delete(account);
                status = api.Add(add);
            }

            if (status != ErrSecSuccess)
                throw new InvalidOperationException($"SecItemAdd status={status}");
        }
        finally
        {
            api.Release(add);
            api.Release(value);
            api.Release(service);
            api.Release(acc);
        }
    }

    private static void Delete(string account)
    {
        var api = SecApi.Load();
        var service = api.CreateString(Service);
        var acc = api.CreateString(account);
        IntPtr dict = IntPtr.Zero;
        try
        {
            dict = api.CreateQuery(service, acc, returnData: false);
            _ = api.Delete(dict);
        }
        finally
        {
            api.Release(dict);
            api.Release(service);
            api.Release(acc);
        }
    }

    private sealed class SecApi
    {
        private readonly IntPtr _cf;
        private readonly IntPtr KSecClass;
        private readonly IntPtr KSecClassGenericPassword;
        private readonly IntPtr KSecAttrService;
        private readonly IntPtr KSecAttrAccount;
        private readonly IntPtr KSecValueData;
        private readonly IntPtr KSecReturnData;
        private readonly IntPtr KSecMatchLimit;
        private readonly IntPtr KSecMatchLimitOne;
        private readonly IntPtr KCfBooleanTrue;
        private readonly CopyMatchingDelegate _copyMatching;
        private readonly ItemAddDelegate _add;
        private readonly ItemDeleteDelegate _delete;
        private readonly CfDictCreateDelegate _cfDictCreate;
        private readonly CfReleaseDelegate _cfRelease;
        private readonly CfStringCreateDelegate _cfStringCreate;
        private readonly CfDataCreateDelegate _cfDataCreate;
        private readonly CfDataLengthDelegate _cfDataLength;
        private readonly CfDataBytePtrDelegate _cfDataBytePtr;

        private SecApi(IntPtr sec, IntPtr cf)
        {
            _cf = cf;
            KSecClass = ReadRef(sec, "kSecClass");
            KSecClassGenericPassword = ReadRef(sec, "kSecClassGenericPassword");
            KSecAttrService = ReadRef(sec, "kSecAttrService");
            KSecAttrAccount = ReadRef(sec, "kSecAttrAccount");
            KSecValueData = ReadRef(sec, "kSecValueData");
            KSecReturnData = ReadRef(sec, "kSecReturnData");
            KSecMatchLimit = ReadRef(sec, "kSecMatchLimit");
            KSecMatchLimitOne = ReadRef(sec, "kSecMatchLimitOne");
            KCfBooleanTrue = ReadRef(cf, "kCFBooleanTrue");
            _copyMatching = Load<CopyMatchingDelegate>(sec, "SecItemCopyMatching");
            _add = Load<ItemAddDelegate>(sec, "SecItemAdd");
            _delete = Load<ItemDeleteDelegate>(sec, "SecItemDelete");
            _cfDictCreate = Load<CfDictCreateDelegate>(cf, "CFDictionaryCreate");
            _cfRelease = Load<CfReleaseDelegate>(cf, "CFRelease");
            _cfStringCreate = Load<CfStringCreateDelegate>(cf, "CFStringCreateWithCString");
            _cfDataCreate = Load<CfDataCreateDelegate>(cf, "CFDataCreate");
            _cfDataLength = Load<CfDataLengthDelegate>(cf, "CFDataGetLength");
            _cfDataBytePtr = Load<CfDataBytePtrDelegate>(cf, "CFDataGetBytePtr");
        }

        public static SecApi Load()
        {
            if (!NativeLibrary.TryLoad(SecurityPath, out var sec) ||
                !NativeLibrary.TryLoad(CoreFoundationPath, out var cf))
            {
                throw new InvalidOperationException("Unable to load Security.framework.");
            }

            return new SecApi(sec, cf);
        }

        public int CopyMatching(IntPtr query, out IntPtr result) => _copyMatching(query, out result);

        public int Add(IntPtr attrs) => _add(attrs, IntPtr.Zero);

        public int Delete(IntPtr query) => _delete(query);

        public void Release(IntPtr cf)
        {
            if (cf != IntPtr.Zero)
                _cfRelease(cf);
        }

        public IntPtr CreateString(string value) =>
            _cfStringCreate(IntPtr.Zero, value, Utf8);

        public IntPtr CreateData(byte[] bytes)
        {
            var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try
            {
                return _cfDataCreate(IntPtr.Zero, handle.AddrOfPinnedObject(), bytes.Length);
            }
            finally
            {
                handle.Free();
            }
        }

        public byte[] CfDataToBytes(IntPtr data)
        {
            var len = (int)_cfDataLength(data);
            var ptr = _cfDataBytePtr(data);
            var bytes = new byte[len];
            Marshal.Copy(ptr, bytes, 0, len);
            return bytes;
        }

        public IntPtr CreateQuery(IntPtr service, IntPtr account, bool returnData)
        {
            if (returnData)
            {
                var keys = new[] { KSecClass, KSecAttrService, KSecAttrAccount, KSecReturnData, KSecMatchLimit };
                var values = new[] { KSecClassGenericPassword, service, account, KCfBooleanTrue, KSecMatchLimitOne };
                return Dict(keys, values);
            }

            return Dict(
                [KSecClass, KSecAttrService, KSecAttrAccount],
                [KSecClassGenericPassword, service, account]);
        }

        public IntPtr CreateAdd(IntPtr service, IntPtr account, IntPtr value) =>
            Dict(
                [KSecClass, KSecAttrService, KSecAttrAccount, KSecValueData],
                [KSecClassGenericPassword, service, account, value]);

        private IntPtr Dict(IntPtr[] keys, IntPtr[] values)
        {
            var kh = GCHandle.Alloc(keys, GCHandleType.Pinned);
            var vh = GCHandle.Alloc(values, GCHandleType.Pinned);
            try
            {
                return _cfDictCreate(
                    IntPtr.Zero,
                    kh.AddrOfPinnedObject(),
                    vh.AddrOfPinnedObject(),
                    keys.Length,
                    IntPtr.Zero,
                    IntPtr.Zero);
            }
            finally
            {
                kh.Free();
                vh.Free();
            }
        }

        private static IntPtr ReadRef(IntPtr lib, string name)
        {
            if (!NativeLibrary.TryGetExport(lib, name, out var addr) || addr == IntPtr.Zero)
                throw new InvalidOperationException($"Missing native export {name}");
            return Marshal.ReadIntPtr(addr);
        }

        private static T Load<T>(IntPtr lib, string name) where T : Delegate
        {
            if (!NativeLibrary.TryGetExport(lib, name, out var addr) || addr == IntPtr.Zero)
                throw new InvalidOperationException($"Missing native export {name}");
            return Marshal.GetDelegateForFunctionPointer<T>(addr);
        }

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int CopyMatchingDelegate(IntPtr query, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int ItemAddDelegate(IntPtr attributes, IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int ItemDeleteDelegate(IntPtr query);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDictCreateDelegate(
            IntPtr allocator, IntPtr keys, IntPtr values, nint n, IntPtr keyCb, IntPtr valueCb);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate void CfReleaseDelegate(IntPtr cf);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfStringCreateDelegate(
            IntPtr alloc, [MarshalAs(UnmanagedType.LPUTF8Str)] string str, uint encoding);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDataCreateDelegate(IntPtr allocator, IntPtr bytes, nint length);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate nint CfDataLengthDelegate(IntPtr data);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate IntPtr CfDataBytePtrDelegate(IntPtr data);
    }
}
