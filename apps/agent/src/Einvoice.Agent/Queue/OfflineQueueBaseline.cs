/// <summary>
/// Baseline inventory for 010-offline-sync (T012): reuse existing SQLite queue only.
/// Resume points:
/// - SigningWorker.TickAsync → ProcessPendingUploadAsync resumes PENDING_UPLOAD after reconnect.
/// - SqliteOfflineQueue states: PENDING_SIGN → PENDING_UPLOAD → DONE | DEAD.
/// - AgentApiClient.SubmitAsync sends Idempotency-Key = DocumentId:v{DocumentVersion}.
/// Do not introduce a second offline database.
/// </summary>
namespace Einvoice.Agent.Queue;

public static class OfflineQueueBaseline
{
    public const string Feature = "010-offline-sync";
}
