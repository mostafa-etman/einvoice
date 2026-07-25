using Einvoice.Agent.Queue;
using Xunit;

namespace Einvoice.Agent.Tests;

public class OfflineQueueTests
{
    [Fact]
    public void Create_insert_and_recover_one_item()
    {
        var dir = Path.Combine(Path.GetTempPath(), "einvoice-agent-queue-tests", Guid.NewGuid().ToString("N"));
        var dbPath = Path.Combine(dir, "queue.db");

        try
        {
            long id;
            using (var queue = new SqliteOfflineQueue(dbPath))
            {
                id = queue.Enqueue(
                    jobId: "job-1",
                    documentId: "doc-1",
                    documentVersion: 3,
                    payloadJson: """{"internalID":"INV-1"}""");
                Assert.True(id > 0);
            }

            using (var recovered = new SqliteOfflineQueue(dbPath))
            {
                var item = recovered.GetById(id);
                Assert.NotNull(item);
                Assert.Equal("job-1", item!.JobId);
                Assert.Equal("doc-1", item.DocumentId);
                Assert.Equal(3, item.DocumentVersion);
                Assert.Equal("""{"internalID":"INV-1"}""", item.PayloadJson);
                Assert.Equal(SqliteOfflineQueue.StatePendingSign, item.State);
                Assert.Equal(0, item.Attempts);

                var all = recovered.ListAll();
                Assert.Single(all);
                Assert.Equal(id, all[0].Id);
            }
        }
        finally
        {
            try
            {
                if (Directory.Exists(dir))
                {
                    Directory.Delete(dir, recursive: true);
                }
            }
            catch
            {
                // best-effort cleanup on Windows file locks
            }
        }
    }
}
