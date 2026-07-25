// Serialize-only harness: EXACT Serialize / SerializeToken from
// https://github.com/bassemAgmi/EInvoicingSigner (EInvoicingSigner/Signer.cs).
// No PKCS#11 / signing. Used to produce candidate CanonicalString.txt outputs.
// Confirmed fixtures still require running the full EInvoicingSigner locally.

using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

static class ReferenceSerialize
{
    // Identical to TokenSigner.Serialize / SerializeToken in bassemAgmi/EInvoicingSigner.
    public static string Serialize(JObject request) => SerializeToken(request);

    private static string SerializeToken(JToken request)
    {
        string serialized = "";
        if (request.Parent is null)
        {
            SerializeToken(request.First!);
        }
        else
        {
            if (request.Type == JTokenType.Property)
            {
                string name = ((JProperty)request).Name.ToUpper();
                serialized += "\"" + name + "\"";
                foreach (var property in request)
                {
                    if (property.Type == JTokenType.Object)
                    {
                        serialized += SerializeToken(property);
                    }
                    if (property.Type == JTokenType.Boolean
                        || property.Type == JTokenType.Integer
                        || property.Type == JTokenType.Float
                        || property.Type == JTokenType.Date)
                    {
                        serialized += "\"" + property.Value<string>() + "\"";
                    }
                    if (property.Type == JTokenType.String)
                    {
                        serialized += JsonConvert.ToString(property.Value<string>());
                    }
                    if (property.Type == JTokenType.Array)
                    {
                        foreach (var item in property.Children())
                        {
                            serialized += "\"" + ((JProperty)request).Name.ToUpper() + "\"";
                            serialized += SerializeToken(item);
                        }
                    }
                }
            }
            // Added to fix "References"
            if (request.Type == JTokenType.String)
            {
                serialized += JsonConvert.ToString(request.Value<string>());
            }
        }
        if (request.Type == JTokenType.Object)
        {
            foreach (var property in request.Children())
            {
                if (property.Type == JTokenType.Object || property.Type == JTokenType.Property)
                {
                    serialized += SerializeToken(property);
                }
            }
        }

        return serialized;
    }
}

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.Error.WriteLine(
                "Usage: ReferenceCanonicalSerialize <SourceDocumentJson.json> [CanonicalString.txt]");
            Console.Error.WriteLine(
                "  Reads JSON with the same JsonSerializerSettings as EInvoicingSigner,");
            Console.Error.WriteLine(
                "  writes UTF-8 CanonicalString.txt (no trailing newline) via bassemAgmi SerializeToken.");
            return 1;
        }

        string inputPath = args[0];
        string outputPath = args.Length >= 2
            ? args[1]
            : Path.Combine(Path.GetDirectoryName(inputPath) ?? ".", "CanonicalString.txt");

        string sourceDocumentJson = File.ReadAllText(inputPath, Encoding.UTF8);
        JObject request = JsonConvert.DeserializeObject<JObject>(
            sourceDocumentJson,
            new JsonSerializerSettings()
            {
                FloatFormatHandling = FloatFormatHandling.String,
                FloatParseHandling = FloatParseHandling.Decimal,
                DateFormatHandling = DateFormatHandling.IsoDateFormat,
                DateParseHandling = DateParseHandling.None
            })!;

        string canonicalString = ReferenceSerialize.Serialize(request);
        File.WriteAllBytes(outputPath, Encoding.UTF8.GetBytes(canonicalString));
        Console.WriteLine($"Wrote {outputPath} ({Encoding.UTF8.GetByteCount(canonicalString)} bytes UTF-8)");
        return 0;
    }
}
