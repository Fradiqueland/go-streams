using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using System.Text;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using Microsoft.Win32;

class Launcher {
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);

    internal static string BrowserArguments(string url, string profile) {
        return "--user-data-dir=" + EscapeArgument(profile) +
            " --profile-directory=Default --no-first-run --no-default-browser-check --disable-background-mode" +
            " --hide-crash-restore-bubble --disable-sync --disable-features=msImplicitSignin,Translate,msEdgeTranslate" +
            " --edge-skip-compat-layer-relaunch --window-size=1440,960 --app=" + EscapeArgument(url);
    }

    internal static string PrepareBrowserProfile(string data) {
        string profile = Path.Combine(data, "desktop-browser");
        Directory.CreateDirectory(profile);
        string marker = Path.Combine(profile, "First Run");
        // Only initialise our dedicated profile; never reset existing preferences.
        try { using (File.Open(marker, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { } }
        catch (IOException) { if (!File.Exists(marker)) throw; }
        return profile;
    }

    internal static string EscapeArgument(string value) {
        return "\"" + Regex.Replace(Regex.Replace(value, @"(\\*)""", "$1$1\\\""), @"(\\+)$", "$1$1") + "\"";
    }

    internal static bool ValidSession(string value, int port) {
        return Regex.IsMatch(value, @"\Ahttp://127\.0\.0\.1:" + port + @"/\?launch=[a-f0-9]{64}\z");
    }

    internal static string DataDirectory(string root) {
        string data = Environment.GetEnvironmentVariable("GO_STREAMS_DATA");
        if (!String.IsNullOrWhiteSpace(data)) return Path.GetFullPath(data);
        if (Installed(root)) {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string existing = InstalledDataDirectory(local, null);
            if (Directory.Exists(existing) && Directory.GetFileSystemEntries(existing).Length > 0) return existing;
            string legacy = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Antonio Fradique\Go Streams", "LegacyDataDirectory", null) as string;
            if (String.IsNullOrWhiteSpace(legacy)) {
                string source = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Antonio Fradique\Go Streams", "LegacyPortableRoot", null) as string;
                legacy = FindPortableData(source);
            }
            return InstalledDataDirectory(local, legacy);
        }
        data = Path.Combine(root, "data");
        var folder = new DirectoryInfo(root);
        if (!Directory.Exists(data) && folder.Name.StartsWith("GoStreams-") && folder.Parent != null) {
            Version latest = new Version(0,0,0); string previous = null;
            foreach (string candidate in Directory.GetDirectories(folder.Parent.FullName, "GoStreams-*")) {
                Version version; string name = new DirectoryInfo(candidate).Name.Substring(10);
                string previousData = Path.Combine(candidate, "data");
                if (Version.TryParse(name, out version) && version > latest && File.Exists(Path.Combine(previousData, "project.json"))) {
                    latest = version; previous = previousData;
                }
            }
            string legacy = Path.Combine(folder.Parent.FullName, "GoStreams", "data");
            if (previous != null) data = previous;
            else if (Directory.Exists(legacy)) data = legacy;
        }
        return data;
    }

    internal static bool Installed(string root) {
        string marker = Path.Combine(root, ".installed");
        return File.Exists(marker) && File.ReadAllText(marker).Trim() == "go-streams-installed-v1";
    }

    internal static string FindPortableData(string source) {
        if (String.IsNullOrWhiteSpace(source) || !Directory.Exists(source)) return null;
        var candidates = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string relative in new[]{"GoStreams-data", "data", Path.Combine("GoStreams", "data")}) {
            string candidate = Path.Combine(source, relative);
            if (File.Exists(Path.Combine(candidate, "project.json"))) candidates.Add(Path.GetFullPath(candidate));
        }
        foreach (string child in Directory.GetDirectories(source, "GoStreams*")) {
            string candidate = Path.Combine(child, "data");
            if (File.Exists(Path.Combine(candidate, "project.json"))) candidates.Add(Path.GetFullPath(candidate));
        }
        if (candidates.Count > 1) throw new IOException("More than one portable project was found. Run setup again with LEGACYDATADIR set to the data folder you want to keep.");
        foreach (string candidate in candidates) return candidate;
        return null;
    }

    static void RegularDataPath(string path) {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("The old data folder contains a directory link. Export its project before switching installations.");
    }

    static void CopyDataTree(string source, string destination) {
        RegularDataPath(source); Directory.CreateDirectory(destination);
        foreach (string file in Directory.GetFiles(source)) {
            RegularDataPath(file);
            // A local engine token is transient; browser cookies and profiles are kept.
            if (Path.GetFileName(file).Equals("session.url", StringComparison.OrdinalIgnoreCase)) continue;
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var output = new FileStream(Path.Combine(destination, Path.GetFileName(file)), FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                input.CopyTo(output); output.Flush(true);
            }
        }
        foreach (string child in Directory.GetDirectories(source))
            CopyDataTree(child, Path.Combine(destination, Path.GetFileName(child)));
    }

    internal static string InstalledDataDirectory(string localData, string legacy) {
        string target = Path.GetFullPath(Path.Combine(localData, "Go Streams", "data"));
        string parent = Path.GetDirectoryName(target), stage = null;
        using (var mutex = new Mutex(false, @"Local\GoStreams.InstalledDataMigration")) {
            bool acquired = false;
            try {
                try { acquired = mutex.WaitOne(30000); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new IOException("Another Go Streams launch is preserving your existing data. Try again shortly.");
                // Never merge into or overwrite any existing installed user data.
                if (Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length > 0) return target;
                if (String.IsNullOrWhiteSpace(legacy)) return target;
                legacy = Path.GetFullPath(legacy).TrimEnd(Path.DirectorySeparatorChar);
                if (String.Equals(legacy, target, StringComparison.OrdinalIgnoreCase)) return target;
                if (target.StartsWith(legacy + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                    legacy.StartsWith(target + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The old and new data folders must be separate.");
                if (!File.Exists(Path.Combine(legacy, "project.json"))) throw new IOException("Select the portable data folder containing project.json. Its files have not been changed.");
                int port; if (!Int32.TryParse(Environment.GetEnvironmentVariable("GO_STREAMS_PORT"), out port) || port < 1 || port > 65535) port = 4317;
                if (Ready(Session(legacy, port))) throw new IOException("Close the portable Go Streams before importing its profile, then open the installed version again.");
                Directory.CreateDirectory(parent);
                stage = Path.Combine(parent, ".data-migration-" + Guid.NewGuid().ToString("N"));
                CopyDataTree(legacy, stage);
                if (Directory.Exists(target)) Directory.Delete(target); // Only an empty directory, never recursive.
                Directory.Move(stage, target); stage = null;
                return target;
            } finally {
                if (stage != null && Directory.Exists(stage)) {
                    // This is only the newly created private staging directory; source data is untouched.
                    if (Path.GetDirectoryName(stage) != parent || !Path.GetFileName(stage).StartsWith(".data-migration-"))
                        throw new IOException("Invalid migration staging path.");
                    Directory.Delete(stage, true);
                }
                if (acquired) mutex.ReleaseMutex();
            }
        }
    }

    internal static string Session(string data, int port) {
        try { string url = File.ReadAllText(Path.Combine(data, "session.url")).Trim(); return ValidSession(url, port) ? url : null; }
        catch { return null; }
    }

    static HttpWebRequest Request(string url, string endpoint) {
        var address = new Uri(url);
        var request = (HttpWebRequest)WebRequest.Create(address.GetLeftPart(UriPartial.Authority) + endpoint);
        request.Proxy = null; request.AllowAutoRedirect = false;
        request.Timeout = 1500; request.ReadWriteTimeout = 1500;
        request.Headers[HttpRequestHeader.Cookie] = "go_streams=" + address.Query.Substring("?launch=".Length);
        return request;
    }

    internal static bool Ready(string url) {
        if (url == null) return false;
        try {
            using (var response = (HttpWebResponse)Request(url, "/api/ready").GetResponse())
                return response.StatusCode == HttpStatusCode.OK && response.Headers["X-Go-Streams-Ready"] == "1";
        } catch { return false; }
    }

    static void Shutdown(string url) {
        var request = Request(url, "/api/shutdown");
        request.Method = "POST"; request.ContentType = "application/json"; request.Headers["X-Go-Streams"] = "1";
        byte[] body = Encoding.UTF8.GetBytes("{}"); request.ContentLength = body.Length;
        using (var stream = request.GetRequestStream()) stream.Write(body, 0, body.Length);
        using (var response = request.GetResponse()) { }
    }

    internal static string WaitForReady(Func<string> session, Func<string, bool> probe, Func<bool> exited, int timeout) {
        var deadline = Stopwatch.StartNew();
        while (deadline.ElapsedMilliseconds < timeout) {
            if (exited()) return null;
            string url = session();
            if (url != null && probe(url)) return url;
            Thread.Sleep(150);
        }
        return null;
    }

    static string Browser() {
        foreach (string program in new [] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google", "Chrome", "Application", "chrome.exe")
        }) if (File.Exists(program)) return program;
        return null;
    }

    internal static bool HasExited(Process process) {
        if (process == null) return true;
        try { return process.HasExited; } catch { return true; }
    }

    internal static void CloseOwnedBrowser(Process browser) {
        if (HasExited(browser)) return;
        try {
            // This handle is only the dedicated browser started by this launcher.
            // Never terminate Edge/Chrome by name or touch the user's normal profile.
            browser.CloseMainWindow();
            if (!browser.WaitForExit(2000)) browser.Kill();
        } catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }

    static void FocusBrowser(Process browser) {
        var waiting = Stopwatch.StartNew();
        while (!HasExited(browser) && waiting.ElapsedMilliseconds < 10000) {
            browser.Refresh();
            IntPtr window = browser.MainWindowHandle;
            if (window != IntPtr.Zero) {
                if (IsIconic(window)) ShowWindow(window, 9);
                // Raise once at launch/explicit activation, never keep it always on top.
                SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x0043);
                SetForegroundWindow(window);
                return;
            }
            Thread.Sleep(100);
        }
    }

    static void Activate(ref Process browser, string url, string data) {
        if (!HasExited(browser)) {
            FocusBrowser(browser);
            return; // A still-starting browser must not produce a second window.
        }
        if (browser != null) browser.Dispose();
        string executable = Browser();
        if (executable == null) {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            browser = null;
            return;
        }
        string profile = PrepareBrowserProfile(data);
        browser = Process.Start(new ProcessStartInfo(executable, BrowserArguments(url, profile)) {
            UseShellExecute = false, CreateNoWindow = false, WindowStyle = ProcessWindowStyle.Normal
        });
        FocusBrowser(browser);
    }

    static void Log(string data, string message) {
        try {
            Directory.CreateDirectory(data); string file = Path.Combine(data, "desktop-startup.log");
            if (File.Exists(file) && new FileInfo(file).Length > 65536) File.WriteAllText(file, "");
            File.AppendAllText(file, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
        } catch { }
    }

    [STAThread]
    static void Main(string[] args) { Run(args, AppDomain.CurrentDomain.BaseDirectory, null); }

    internal static void Run(string[] args, string root, string selectedData) {
        int port; if (!Int32.TryParse(Environment.GetEnvironmentVariable("GO_STREAMS_PORT"), out port)) port = 4317;
        if (port < 1 || port > 65535) { MessageBox.Show("Invalid local port.", "Go Streams"); return; }
        string data;
        try { data = selectedData ?? DataDirectory(root); } catch (Exception error) { MessageBox.Show(error.Message, "Go Streams"); return; }
        if (Array.IndexOf(args, "--close") >= 0) {
            if (MessageBox.Show("Close Go Streams and stop its active streams?", "Go Streams", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            try {
                string session = Session(data, port);
                if (session == null) throw new Exception("No Go Streams session was found in this data folder.");
                Shutdown(session);
                var closing = Stopwatch.StartNew();
                while (closing.ElapsedMilliseconds < 10000 && Session(data, port) == session) Thread.Sleep(100);
            } catch { MessageBox.Show("Could not contact this Go Streams session. Its data was preserved.", "Go Streams"); }
            return;
        }
        string node = Path.Combine(root, "runtime", "win32-x64", "node.exe"), server = Path.Combine(root, "src", "server.mjs");
        if (!File.Exists(node) || !File.Exists(server)) {
            MessageBox.Show("Extract the complete Go Streams folder before opening the application.", "Go Streams"); return;
        }
        bool first;
        using (var mutex = new Mutex(true, "Local\\GoStreams.Desktop." + port, out first)) {
            string eventName = "Local\\GoStreams.Activate." + port;
            if (!first) {
                bool signalled = false, acquired = false;
                for (int attempt = 0; attempt < 30 && !signalled && !acquired; attempt++) {
                    try { using (var activation = EventWaitHandle.OpenExisting(eventName)) activation.Set(); signalled = true; }
                    catch (WaitHandleCannotBeOpenedException) {
                        try { acquired = mutex.WaitOne(100); }
                        catch (AbandonedMutexException) { acquired = true; }
                    }
                }
                if (signalled) return;
                if (!acquired) {
                    MessageBox.Show("An older Go Streams launcher is running. Close that session before opening this version; restarting Windows is not required.", "Go Streams");
                    return;
                }
            }
            Process engine = null, browser = null; var errors = new StringBuilder(); string url = null;
            using (var activation = new EventWaitHandle(false, EventResetMode.AutoReset, eventName)) {
                try {
                    Log(data, "Launcher started.");
                    url = Session(data, port);
                    if (!Ready(url)) {
                        var info = new ProcessStartInfo(node, EscapeArgument(server));
                        info.WorkingDirectory = root; info.UseShellExecute = false;
                        info.EnvironmentVariables["GO_STREAMS_DATA"] = data;
                        info.EnvironmentVariables["GO_STREAMS_PORT"] = port.ToString();
                        info.CreateNoWindow = true; info.WindowStyle = ProcessWindowStyle.Hidden;
                        info.RedirectStandardError = true; info.RedirectStandardOutput = true;
                        engine = new Process { StartInfo = info };
                        engine.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs line) {
                            if (line.Data != null) lock (errors) { if (errors.Length < 4096) errors.AppendLine(line.Data); }
                        };
                        engine.OutputDataReceived += delegate { }; // Session URLs are not persisted to logs.
                        engine.Start(); engine.BeginErrorReadLine(); engine.BeginOutputReadLine();
                        url = WaitForReady(() => Session(data, port), Ready, () => HasExited(engine), 45000);
                        if (url == null) {
                            if (HasExited(engine)) {
                                engine.WaitForExit();
                                throw new Exception(errors.Length == 0 ? "The local engine could not start." : errors.ToString());
                            }
                            throw new Exception("The local engine did not become ready. Close Go Streams with CloseGoStreams.cmd and try again.");
                        }
                    }
                    Log(data, "Engine ready. Opening dedicated application window.");
                    Activate(ref browser, url, data);
                    var heartbeat = Stopwatch.StartNew();
                    while (engine == null || !HasExited(engine)) {
                        if (activation.WaitOne(200)) {
                            Activate(ref browser, url, data);
                            Log(data, "Application window activated.");
                        }
                        if (engine == null && heartbeat.ElapsedMilliseconds > 3000) {
                            if (!Ready(url)) break;
                            heartbeat.Restart();
                        }
                    }
                    Log(data, "Engine stopped. Closing owned application window.");
                    if (engine != null && engine.ExitCode != 0) throw new Exception("The local engine stopped unexpectedly.");
                } catch (Exception error) {
                    Log(data, "Startup or engine failure. Data preserved.");
                    string shutdownSession = url ?? Session(data, port);
                    if (engine != null && !HasExited(engine) && shutdownSession != null) {
                        try { Shutdown(shutdownSession); engine.WaitForExit(5000); } catch { }
                    }
                    MessageBox.Show(error.Message, "Go Streams");
                } finally {
                    CloseOwnedBrowser(browser);
                    if (browser != null) browser.Dispose();
                    if (engine != null) engine.Dispose();
                    mutex.ReleaseMutex();
                }
            }
        }
    }
}
