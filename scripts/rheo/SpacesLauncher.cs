using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// Local release paths and hashes are replaced by build-spaces-desktop.ts.
internal static class SpacesLauncher
{
    private const string Release = __RELEASE__;
    private const string ManifestHash = __MANIFEST_HASH__;
    private const string ScriptHash = __SCRIPT_HASH__;
    private const string LibraryHash = __LIBRARY_HASH__;
    private const string PowerShell = __POWERSHELL__;
    private const string Version = __VERSION__;

    private static void Verify(string file, string expected)
    {
        for (string part = file; part != null; part = Path.GetDirectoryName(part))
            if ((File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("A pasta da versão Spaces contém uma ligação. Reponha o pacote original.");
        using (var hash = SHA256.Create())
        using (var input = File.OpenRead(file))
            if (BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "").ToLowerInvariant() != expected)
                throw new IOException("A versão Spaces foi alterada: " + Path.GetFileName(file));
    }

    private static string Run(string option)
    {
        var entry = Path.Combine(Release, "scripts", "rheo", "Open-Spaces.ps1");
        Verify(Path.Combine(Release, "spaces-release.json"), ManifestHash);
        Verify(entry, ScriptHash);
        Verify(Path.Combine(Release, "scripts", "rheo", "Stop-Spaces.ps1"), LibraryHash);
        if (!File.Exists(PowerShell))
            throw new IOException("O PowerShell 7 desta instalação já não está disponível. Reconstrua o lançador Spaces após atualizar o Codex.");
        var start = new ProcessStartInfo(PowerShell, "-NoProfile -NonInteractive -File \"" + entry + "\"" + option);
        start.WorkingDirectory = Release;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        using (var child = Process.Start(start))
        {
            var errors = child.StandardError.ReadToEndAsync();
            var output = child.StandardOutput.ReadToEnd();
            child.WaitForExit();
            var error = errors.GetAwaiter().GetResult();
            if (child.ExitCode != 0)
                throw new IOException((error.Length > 0 ? error : output).Trim());
            return output.Trim();
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0)
        {
            try
            {
                if (args.Length != 1 || (args[0] != "--check" && args[0] != "--stop" && args[0] != "--no-browser"))
                    throw new ArgumentException("Use --check, --stop ou --no-browser.");
                Console.WriteLine(Run(args[0] == "--check" ? " -Check" : args[0] == "--stop" ? " -Stop" : ""));
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        }
        Application.EnableVisualStyles();
        using (var window = new Form())
        {
            window.Text = "Spaces — " + Version;
            window.ClientSize = new System.Drawing.Size(380, 92);
            window.FormBorderStyle = FormBorderStyle.FixedDialog;
            window.StartPosition = FormStartPosition.CenterScreen;
            window.MaximizeBox = false;
            window.MinimizeBox = false;
            window.ControlBox = false;
            var label = new Label { Text = "A verificar e abrir o Spaces…", Left = 20, Top = 18, Width = 340 };
            var progress = new ProgressBar { Style = ProgressBarStyle.Marquee, Left = 20, Top = 51, Width = 340, Height = 12 };
            window.Controls.Add(label);
            window.Controls.Add(progress);
            window.Shown += async delegate
            {
                try
                {
                    await Task.Run(() => Run(""));
                    Process.Start(new ProcessStartInfo("http://localhost:4410") { UseShellExecute = true });
                }
                catch (Exception error)
                {
                    window.Tag = 1;
                    MessageBox.Show(window, error.Message, "Spaces não abriu", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally { window.Close(); }
            };
            Application.Run(window);
            return window.Tag == null ? 0 : 1;
        }
    }
}
