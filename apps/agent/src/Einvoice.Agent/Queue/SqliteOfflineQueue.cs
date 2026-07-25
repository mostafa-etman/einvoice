using Microsoft.Data.Sqlite;

namespace Einvoice.Agent.Queue;

public sealed class LocalQueueItem
{
    public long Id { get; init; }
    public string JobId { get; init; } = "";
    public string DocumentId { get; init; } = "";
    public int DocumentVersion { get; init; }
    public string PayloadJson { get; init; } = "";
    public string? SignedJson { get; init; }
    public string State { get; init; } = "";
    public int Attempts { get; init; }
    public string? LastError { get; init; }
    public string UpdatedAt { get; init; } = "";
}

/// <summary>SQLite offline queue: PENDING_SIGN → PENDING_UPLOAD → DONE | DEAD.</summary>
public sealed class SqliteOfflineQueue : IDisposable
{
    public const string StatePendingSign = "PENDING_SIGN";
    public const string StatePendingUpload = "PENDING_UPLOAD";
    public const string StateDone = "DONE";
    public const string StateDead = "DEAD";

    private readonly SqliteConnection _connection;

    public SqliteOfflineQueue(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        var dir = Path.GetDirectoryName(databasePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

        _connection = new SqliteConnection($"Data Source={databasePath}");
        _connection.Open();
        EnsureSchema();
    }

    private void EnsureSchema()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            CREATE TABLE IF NOT EXISTS LocalQueueItem (
                Id INTEGER PRIMARY KEY AUTOINCREMENT,
                JobId TEXT NOT NULL UNIQUE,
                DocumentId TEXT NOT NULL,
                DocumentVersion INTEGER NOT NULL,
                PayloadJson TEXT NOT NULL,
                SignedJson TEXT,
                State TEXT NOT NULL,
                Attempts INTEGER NOT NULL DEFAULT 0,
                LastError TEXT,
                UpdatedAt TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS IX_LocalQueueItem_State ON LocalQueueItem(State);
            """;
        cmd.ExecuteNonQuery();
    }

    public long Enqueue(string jobId, string documentId, int documentVersion, string payloadJson, string state = StatePendingSign)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            INSERT INTO LocalQueueItem (JobId, DocumentId, DocumentVersion, PayloadJson, State, Attempts, UpdatedAt)
            VALUES ($jobId, $documentId, $documentVersion, $payloadJson, $state, 0, $updatedAt)
            ON CONFLICT(JobId) DO UPDATE SET
              PayloadJson=excluded.PayloadJson,
              DocumentVersion=excluded.DocumentVersion,
              UpdatedAt=excluded.UpdatedAt
            WHERE State IN ('PENDING_SIGN','PENDING_UPLOAD');
            SELECT Id FROM LocalQueueItem WHERE JobId=$jobId;
            """;
        cmd.Parameters.AddWithValue("$jobId", jobId);
        cmd.Parameters.AddWithValue("$documentId", documentId);
        cmd.Parameters.AddWithValue("$documentVersion", documentVersion);
        cmd.Parameters.AddWithValue("$payloadJson", payloadJson);
        cmd.Parameters.AddWithValue("$state", state);
        cmd.Parameters.AddWithValue("$updatedAt", DateTime.UtcNow.ToString("O"));
        return (long)cmd.ExecuteScalar()!;
    }

    public IReadOnlyList<LocalQueueItem> ListByState(string state)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, JobId, DocumentId, DocumentVersion, PayloadJson, SignedJson, State, Attempts, LastError, UpdatedAt
            FROM LocalQueueItem WHERE State = $state ORDER BY Id;
            """;
        cmd.Parameters.AddWithValue("$state", state);
        return ReadAll(cmd);
    }

    public void MarkSigned(long id, string signedJson)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            UPDATE LocalQueueItem
            SET SignedJson=$signedJson, State=$state, LastError=NULL, UpdatedAt=$updatedAt
            WHERE Id=$id;
            """;
        cmd.Parameters.AddWithValue("$signedJson", signedJson);
        cmd.Parameters.AddWithValue("$state", StatePendingUpload);
        cmd.Parameters.AddWithValue("$updatedAt", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void MarkDone(long id)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            UPDATE LocalQueueItem SET State=$state, LastError=NULL, UpdatedAt=$updatedAt WHERE Id=$id;
            """;
        cmd.Parameters.AddWithValue("$state", StateDone);
        cmd.Parameters.AddWithValue("$updatedAt", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void MarkAttemptFailed(long id, string error, bool dead, int maxAttempts = 8)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            UPDATE LocalQueueItem
            SET Attempts = Attempts + 1,
                LastError = $error,
                State = CASE WHEN Attempts + 1 >= $max OR $dead = 1 THEN $deadState ELSE State END,
                UpdatedAt = $updatedAt
            WHERE Id = $id;
            """;
        cmd.Parameters.AddWithValue("$error", error);
        cmd.Parameters.AddWithValue("$max", maxAttempts);
        cmd.Parameters.AddWithValue("$dead", dead ? 1 : 0);
        cmd.Parameters.AddWithValue("$deadState", StateDead);
        cmd.Parameters.AddWithValue("$updatedAt", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
    }

    public void CancelJob(string jobId, string reason)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            UPDATE LocalQueueItem
            SET State=$dead, LastError=$reason, UpdatedAt=$updatedAt
            WHERE JobId=$jobId AND State IN ('PENDING_SIGN','PENDING_UPLOAD');
            """;
        cmd.Parameters.AddWithValue("$dead", StateDead);
        cmd.Parameters.AddWithValue("$reason", reason);
        cmd.Parameters.AddWithValue("$updatedAt", DateTime.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$jobId", jobId);
        cmd.ExecuteNonQuery();
    }

    public int CountPending() =>
        ListByState(StatePendingSign).Count + ListByState(StatePendingUpload).Count;

    public LocalQueueItem? GetById(long id)
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, JobId, DocumentId, DocumentVersion, PayloadJson, SignedJson, State, Attempts, LastError, UpdatedAt
            FROM LocalQueueItem WHERE Id = $id;
            """;
        cmd.Parameters.AddWithValue("$id", id);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? ReadItem(reader) : null;
    }

    public IReadOnlyList<LocalQueueItem> ListAll()
    {
        using var cmd = _connection.CreateCommand();
        cmd.CommandText =
            """
            SELECT Id, JobId, DocumentId, DocumentVersion, PayloadJson, SignedJson, State, Attempts, LastError, UpdatedAt
            FROM LocalQueueItem ORDER BY Id;
            """;
        return ReadAll(cmd);
    }

    private static List<LocalQueueItem> ReadAll(SqliteCommand cmd)
    {
        using var reader = cmd.ExecuteReader();
        var items = new List<LocalQueueItem>();
        while (reader.Read()) items.Add(ReadItem(reader));
        return items;
    }

    private static LocalQueueItem ReadItem(SqliteDataReader reader) =>
        new()
        {
            Id = reader.GetInt64(0),
            JobId = reader.GetString(1),
            DocumentId = reader.GetString(2),
            DocumentVersion = reader.GetInt32(3),
            PayloadJson = reader.GetString(4),
            SignedJson = reader.IsDBNull(5) ? null : reader.GetString(5),
            State = reader.GetString(6),
            Attempts = reader.GetInt32(7),
            LastError = reader.IsDBNull(8) ? null : reader.GetString(8),
            UpdatedAt = reader.GetString(9),
        };

    public void Dispose() => _connection.Dispose();
}
