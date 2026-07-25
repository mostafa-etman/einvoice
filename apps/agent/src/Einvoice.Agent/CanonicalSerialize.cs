using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Einvoice.Agent;

/// <summary>
/// Exact SerializeToken algorithm from bassemAgmi/EInvoicingSigner (CanonicalString.txt).
/// </summary>
public static class CanonicalSerialize
{
    public static string Serialize(JObject request) => SerializeToken(request);

    public static string SerializeFromJson(string sourceDocumentJson)
    {
        var request = JsonConvert.DeserializeObject<JObject>(
            sourceDocumentJson,
            new JsonSerializerSettings
            {
                FloatFormatHandling = FloatFormatHandling.String,
                FloatParseHandling = FloatParseHandling.Decimal,
                DateFormatHandling = DateFormatHandling.IsoDateFormat,
                DateParseHandling = DateParseHandling.None
            })!;
        return Serialize(request);
    }

    private static string SerializeToken(JToken request)
    {
        string serialized = "";
        if (request.Parent is null)
        {
            _ = SerializeToken(request.First!);
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
