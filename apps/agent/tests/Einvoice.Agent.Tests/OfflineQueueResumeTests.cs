using Einvoice.Agent.Queue;
using Xunit;

namespace Einvoice.Agent.Tests;

public class OfflineQueueResumeTests
{
    [Fact]
    public void SignedJson_retained_across_failed_upload_state()
    {
        var dir = Path.Combine(Path.GetTempPath(), "einvoice-agent-offline-resume", Guid.NewGuid().ToString("N"));
        var dbPath = Path.Combine(dir, "queue.db");
        try
        {
            long id;
            using (var queue = new SqliteOfflineQueue(dbPath))
            {
                id = queue.Enqueue("job-r1", "doc-1", 2, """{"a":1}""");
                queue.MarkSigned(id, """{"documentId":"doc-1","documentVersion":2,"cadesBase64":"QQ=="}""");
                queue.MarkAttemptFailed(id, "network down", dead: false);
            }

            using (var recovered = new SqliteOfflineQueue(dbPath))
            {
                var item = recovered.GetById(id);
                Assert.NotNull(item);
                Assert.Equal(SqliteOfflineQueue.StatePendingUpload, item!.State);
                Assert.Contains("cadesBase64", item.SignedJson);
                Assert.True(item.Attempts >= 1);
            }
        }
        finally
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { /* ignore */ }
        }
    }

    [Fact]
    public void QueueDatabasePath_persists_file_across_reopen()
    {
        var dir = Path.Combine(Path.GetTempPath(), "einvoice-agent-offline-resume", Guid.NewGuid().ToString("N"));
        var dbPath = Path.Combine(dir, "queue.db");
        try
        {
            using (var queue = new SqliteOfflineQueue(dbPath))
            {
                queue.Enqueue("job-persist", "doc-p", 1, "{}");
            }
            Assert.True(File.Exists(dbPath));
            using (var again = new SqliteOfflineQueue(dbPath))
            {
                Assert.Single(again.ListAll());
            }
        }
        finally
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { /* ignore */ }
        }
    }
}
