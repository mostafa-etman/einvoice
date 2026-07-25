using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent.Signing;

/// <summary>
/// Builds the pre-canonical signing input: document JSON without <c>signatures</c>.
/// </summary>
public static class SigningInput
{
    private static readonly JsonSerializerSettings ParseSettings = new()
    {
        FloatFormatHandling = FloatFormatHandling.String,
        FloatParseHandling = FloatParseHandling.Decimal,
        DateFormatHandling = DateFormatHandling.IsoDateFormat,
        DateParseHandling = DateParseHandling.None,
    };

    public static JObject ParseDocument(string json) =>
        JsonConvert.DeserializeObject<JObject>(json, ParseSettings)!;

    public static JObject StripSignatures(JObject document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var copy = (JObject)document.DeepClone();
        copy.Remove("signatures");
        return copy;
    }

    public static string CanonicalWithoutSignatures(JObject document) =>
        CanonicalSerialize.Serialize(StripSignatures(document));

    public static string CanonicalWithoutSignaturesFromJson(string json)
    {
        var obj = ParseDocument(json);
        return CanonicalWithoutSignatures(obj);
    }
}
