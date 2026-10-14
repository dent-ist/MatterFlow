using System.Text;
using OpenMcdf;

namespace MatterFlow.UnitTests.Intake;

/// <summary>
/// Builds a minimal Outlook <c>.msg</c> (OLE compound file, MS-OXMSG) in memory so the .msg path is tested without a binary fixture.
/// Real Outlook files are richer; the product owner is asked for 2-3 of them (ADR section 7).
/// </summary>
internal static class MsgFixture
{
    public static byte[] Build(string subject, string senderName, string senderEmail, string body, DateTime sentUtc, string addressType = "SMTP")
    {
        using var output = new MemoryStream();
        using (var root = RootStorage.Create(output, OpenMcdf.Version.V3, StorageModeFlags.LeaveOpen))
        {
            Unicode(root, "001A", "IPM.Note"); // PR_MESSAGE_CLASS
            Unicode(root, "0037", subject); // PR_SUBJECT
            Unicode(root, "1000", body); // PR_BODY
            Unicode(root, "0C1A", senderName); // PR_SENDER_NAME
            Unicode(root, "0C1E", addressType); // PR_SENDER_ADDRTYPE
            Unicode(root, "0C1F", senderEmail); // PR_SENDER_EMAIL_ADDRESS
            Unicode(root, "0042", senderName); // PR_SENT_REPRESENTING_NAME
            Unicode(root, "0064", addressType); // PR_SENT_REPRESENTING_ADDRTYPE
            Unicode(root, "0065", senderEmail); // PR_SENT_REPRESENTING_EMAIL_ADDRESS

            // Message-level property stream: 32-byte header, then 16-byte entries (tag, flags, 8-byte value).
            using var props = new MemoryStream();
            props.Write(new byte[32]);
            WriteTime(props, 0x0039, sentUtc); // PR_CLIENT_SUBMIT_TIME
            WriteTime(props, 0x0E06, sentUtc); // PR_MESSAGE_DELIVERY_TIME
            using (var stream = root.CreateStream("__properties_version1.0"))
                stream.Write(props.ToArray());

            root.Flush();
        }

        return output.ToArray();
    }

    private static void Unicode(RootStorage root, string id, string value)
    {
        using var stream = root.CreateStream($"__substg1.0_{id}001F");
        stream.Write(Encoding.Unicode.GetBytes(value));
    }

    private static void WriteTime(Stream stream, ushort id, DateTime utc)
    {
        Span<byte> entry = stackalloc byte[16];
        BitConverter.TryWriteBytes(entry[..4], (uint)(id << 16 | 0x0040));
        BitConverter.TryWriteBytes(entry[4..8], 6u);
        BitConverter.TryWriteBytes(entry[8..], utc.ToFileTimeUtc());
        stream.Write(entry);
    }
}
