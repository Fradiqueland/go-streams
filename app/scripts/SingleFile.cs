using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Reflection;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;

internal sealed class BundleFile {
    internal string Name, Hash;
    internal long Size;
}
internal sealed class BundleSpec {
    internal string Version, ArchiveHash;
    internal long Total;
    internal List<BundleFile> Files = new List<BundleFile>();
    internal static string Relative(string name) {
        if (String.IsNullOrEmpty(name) || name.Contains("\\") || name.StartsWith("/") || Path.IsPathRooted(name))
            throw new InvalidDataException("Invalid package path.");
        foreach (string part in name.Split('/')) {
            if (part.Length == 0 || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") ||
                part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(part, @"\A(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", RegexOptions.IgnoreCase))
                throw new InvalidDataException("Invalid package path.");
        }
        return name;
    }
    internal static BundleSpec Read(Stream stream) {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 1024*1024 };
        var document = new XmlDocument { XmlResolver = null };
        using (var reader = XmlReader.Create(stream, settings)) document.Load(reader);
        XmlElement root = document.DocumentElement;
        if (root == null || root.Name != "bundle" || root.GetAttribute("schema") != "1") throw new InvalidDataException("Invalid bundle manifest.");
        var spec = new BundleSpec { Version = root.GetAttribute("version"), ArchiveHash = root.GetAttribute("sha256") };
        if (!Regex.IsMatch(spec.Version, @"\A[0-9]+\.[0-9]+\.[0-9]+\z") || !Regex.IsMatch(spec.ArchiveHash, @"\A[a-f0-9]{64}\z"))
            throw new InvalidDataException("Invalid bundle identity.");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (XmlNode node in root.ChildNodes) {
            var element = node as XmlElement;
            if (element == null || element.Name != "file") throw new InvalidDataException("Invalid bundle entry.");
            string name = Relative(element.GetAttribute("path")), hash = element.GetAttribute("sha256");
            long size;
            if (name == ".bundle-complete" || name.StartsWith("data/",StringComparison.OrdinalIgnoreCase) || name.StartsWith(".tmp/",StringComparison.OrdinalIgnoreCase) || !names.Add(name) || !Regex.IsMatch(hash, @"\A[a-f0-9]{64}\z") ||
                !Int64.TryParse(element.GetAttribute("bytes"), out size) || size < 0 ||
                size > 4L*1024*1024*1024 || spec.Total > 4L*1024*1024*1024-size)
                throw new InvalidDataException("Invalid bundle entry.");
            spec.Files.Add(new BundleFile { Name = name, Hash = hash, Size = size }); spec.Total += size;
        }
        if (spec.Files.Count == 0 || spec.Files.Count > 4096) throw new InvalidDataException("Invalid package file count.");
        return spec;
    }
}
internal static class SingleFileCache {
    internal static string Hash(Stream stream) {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
    }
    internal static string CachePath(string root, BundleSpec spec) {
        return Path.Combine(Path.GetFullPath(root), spec.Version+"-"+spec.ArchiveHash.Substring(0,24));
    }
    static void Regular(string path) {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Application cache contains a directory link. Use a regular cache folder.");
    }
    static List<string> Tree(string root) {
        var files = new List<string>(); var queue = new Queue<string>(); queue.Enqueue(root);
        while (queue.Count != 0) {
            string folder = queue.Dequeue(); Regular(folder);
            foreach (string file in Directory.GetFiles(folder)) { Regular(file); files.Add(file); }
            foreach (string child in Directory.GetDirectories(folder)) queue.Enqueue(child);
        }
        return files;
    }
    static string Target(string root, string relative) {
        BundleSpec.Relative(relative);
        string target = Path.GetFullPath(Path.Combine(root, relative.Replace('/',Path.DirectorySeparatorChar)));
        if (!target.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Package path escapes application cache.");
        return target;
    }
    static bool Valid(string directory, BundleSpec spec, Action<string,long,long> progress) {
        if (!Directory.Exists(directory)) return false;
        var actual = Tree(directory);
        string marker = Path.Combine(directory,".bundle-complete");
        if (actual.Count != spec.Files.Count+1 || !File.Exists(marker) || File.ReadAllText(marker) != spec.ArchiveHash) return false;
        long checkedBytes = 0;
        foreach (var file in spec.Files) {
            string path = Target(directory,file.Name);
            if (!File.Exists(path) || new FileInfo(path).Length != file.Size) return false;
            using (var input = File.OpenRead(path)) if (Hash(input) != file.Hash) return false;
            checkedBytes += file.Size; progress("Checking application",checkedBytes,spec.Total);
        }
        return true;
    }
    static void RemoveStage(string stage, string root) {
        if (stage == null || !Directory.Exists(stage)) return;
        string full = Path.GetFullPath(stage), parent = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (!String.Equals(Path.GetDirectoryName(full),parent,StringComparison.OrdinalIgnoreCase) ||
            !Path.GetFileName(full).StartsWith(".stage-",StringComparison.Ordinal)) throw new InvalidOperationException("Unsafe staging cleanup.");
        Tree(full); // Refuse to traverse or remove a reparse point.
        Directory.Delete(full,true);
    }
    internal static string Ensure(BundleSpec spec, Func<Stream> archive, string root, Action<string,long,long> progress, out bool reused) {
        root = Path.GetFullPath(root);
        if (root.Length > Path.GetPathRoot(root).Length) root = root.TrimEnd(Path.DirectorySeparatorChar);
        Directory.CreateDirectory(root); Regular(root);
        string directory = CachePath(root,spec), stage = null;
        string lockKey;
        using (var bytes = new MemoryStream(Encoding.UTF8.GetBytes(root.ToUpperInvariant()+spec.ArchiveHash))) lockKey = Hash(bytes).Substring(0,32);
        bool acquired = false; reused = false;
        using (var mutex = new Mutex(false,@"Local\GoStreams.SingleFile."+lockKey)) {
            try {
                var waiting = Stopwatch.StartNew();
                while (!acquired) {
                    try { acquired = mutex.WaitOne(100); } catch (AbandonedMutexException) { acquired = true; }
                    if (!acquired) {
                        progress("Waiting for the other Go Streams launch",0,1);
                        if (waiting.ElapsedMilliseconds > 180000) throw new IOException("Another launch is preparing Go Streams. Try again shortly.");
                    }
                }
                if (Valid(directory,spec,progress)) { reused = true; return directory; }
                progress("Checking the included package",0,1);
                using (var payload = archive()) if (Hash(payload) != spec.ArchiveHash) throw new InvalidDataException("The included application package is damaged.");
                stage = Path.Combine(root,".stage-"+Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(stage);
                using (var payload = archive())
                using (var zip = new ZipArchive(payload,ZipArchiveMode.Read)) {
                    var expected = new Dictionary<string,BundleFile>(StringComparer.Ordinal);
                    foreach (var file in spec.Files) expected.Add(file.Name,file);
                    var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var entry in zip.Entries) {
                        string name = BundleSpec.Relative(entry.FullName); BundleFile file;
                        if (!seen.Add(name) || !expected.TryGetValue(name,out file) || file.Size != entry.Length)
                            throw new InvalidDataException("Unexpected or duplicate application file.");
                    }
                    if (seen.Count != spec.Files.Count) throw new InvalidDataException("The included package is incomplete.");
                    long done = 0; var buffer = new byte[128*1024];
                    foreach (var entry in zip.Entries) {
                        var file = expected[entry.FullName]; string target = Target(stage,file.Name);
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        using (var input = entry.Open())
                        using (var output = new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                        using (var sha = SHA256.Create()) {
                            long written = 0; int count;
                            while ((count = input.Read(buffer,0,buffer.Length)) != 0) {
                                if (written > file.Size-count) throw new InvalidDataException("Application file exceeds its expected size.");
                                output.Write(buffer,0,count); sha.TransformBlock(buffer,0,count,null,0);
                                written += count; done += count; progress("Preparing Go Streams",done,spec.Total);
                            }
                            sha.TransformFinalBlock(new byte[0],0,0);
                            if (written != file.Size || BitConverter.ToString(sha.Hash).Replace("-","").ToLowerInvariant() != file.Hash)
                                throw new InvalidDataException("Application file integrity check failed.");
                            output.Flush(true);
                        }
                    }
                }
                File.WriteAllText(Path.Combine(stage,".bundle-complete"),spec.ArchiveHash,Encoding.ASCII);
                if (Directory.Exists(directory)) {
                    Regular(directory);
                    string previous = Path.Combine(root,".replaced-"+Path.GetFileName(directory)+"-"+Guid.NewGuid().ToString("N"));
                    Directory.Move(directory,previous); // Preserve a damaged cache rather than deleting an unknown tree.
                }
                Directory.Move(stage,directory); stage = null;
                progress("Opening Go Streams",spec.Total,spec.Total);
                return directory;
            } finally {
                try { RemoveStage(stage,root); } catch { /* Keep an unsafe/locked staging folder; never follow a link. */ }
                if (acquired) mutex.ReleaseMutex();
            }
        }
    }
}
internal sealed class PreparingWindow : Form {
    Label status; ProgressBar bar; Stopwatch changed = Stopwatch.StartNew();
    internal bool Cancelled;
    internal PreparingWindow(string version) {
        Text="Go Streams"; Width=490; Height=210; StartPosition=FormStartPosition.CenterScreen;
        FormBorderStyle=FormBorderStyle.FixedDialog; MaximizeBox=false; MinimizeBox=false;
        BackColor=Color.FromArgb(23,44,67); ForeColor=Color.White;
        try { using(var icon=Assembly.GetExecutingAssembly().GetManifestResourceStream("GoStreams.Icon")) if(icon!=null)Icon=new Icon(icon); } catch { }
        var title=new Label { Text="GO STREAMS",Left=26,Top=22,Width=420,Height=32,Font=new Font("Segoe UI",20,FontStyle.Bold) };
        status=new Label { Text="Preparing your application...",Left=28,Top=71,Width=420,Height=38,Font=new Font("Segoe UI",10) };
        bar=new ProgressBar { Left=28,Top=120,Width=420,Height=19,Minimum=0,Maximum=100 };
        Controls.Add(title);Controls.Add(status);Controls.Add(bar);
        FormClosing += delegate { Cancelled=true; };
    }
    internal void Report(string message,long current,long total) {
        if (Cancelled) throw new OperationCanceledException();
        if (changed.ElapsedMilliseconds < 100 && current < total) return;
        if (!IsDisposed) {
            status.Text=message+(total>1?"  "+Math.Min(100,current*100/total)+"%":"");
            bar.Value=(int)Math.Max(0,Math.Min(100,total>0?current*100/total:0));
            changed.Restart(); Application.DoEvents();
        }
        if (Cancelled) throw new OperationCanceledException();
    }
}
internal static class GoStreamsSingleFile {
    internal static string DataDirectory(string outerRoot,string localData) {
        string chosen=Environment.GetEnvironmentVariable("GO_STREAMS_DATA");
        if (!String.IsNullOrWhiteSpace(chosen)) return Path.GetFullPath(chosen);
        string sidecar=Path.Combine(outerRoot,"GoStreams-data");
        if (Directory.Exists(sidecar)) return sidecar;
        foreach (string existing in new[]{Path.Combine(outerRoot,"data"),Path.Combine(outerRoot,"GoStreams","data")})
            if (File.Exists(Path.Combine(existing,"project.json"))) return existing;
        Version latest=new Version(0,0,0);string previous=null;
        foreach(string folder in Directory.GetDirectories(outerRoot,"GoStreams-*")) {
            Version version;string name=Path.GetFileName(folder).Substring(10),data=Path.Combine(folder,"data");
            if (Version.TryParse(name,out version) && version>latest && File.Exists(Path.Combine(data,"project.json"))) {latest=version;previous=data;}
        }
        return previous??Path.Combine(localData,"Go Streams","data");
    }
    static string Json(string value) { return "\""+value.Replace("\\","\\\\").Replace("\"","\\\"").Replace("\r","\\r").Replace("\n","\\n")+"\""; }
    [STAThread]
    static int Main(string[] args) {
        bool verify=Array.IndexOf(args,"--verify")>=0;
        PreparingWindow preparing=null;
        try {
            var assembly=Assembly.GetExecutingAssembly(); BundleSpec spec;
            using(var manifest=assembly.GetManifestResourceStream("GoStreams.Manifest")) {
                if(manifest==null)throw new InvalidDataException("The application manifest is missing.");
                spec=BundleSpec.Read(manifest);
            }
            if(Array.IndexOf(args,"--version")>=0){Console.WriteLine(spec.Version);return 0;}
            string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string outer=Path.GetDirectoryName(assembly.Location),data=DataDirectory(outer,local);
            if(Array.IndexOf(args,"--close")>=0){Launcher.Run(args,outer,data);return 0;}
            string cache=Environment.GetEnvironmentVariable("GO_STREAMS_CACHE");
            if(String.IsNullOrWhiteSpace(cache))cache=Path.Combine(local,"Go Streams","Cache");
            if(!verify){Application.EnableVisualStyles();preparing=new PreparingWindow(spec.Version);preparing.Show();Application.DoEvents();}
            var timer=Stopwatch.StartNew();bool reused;
            Action<string,long,long> report=(message,done,total)=>{if(preparing!=null)preparing.Report(message,done,total);};
            string application=SingleFileCache.Ensure(spec,()=>assembly.GetManifestResourceStream("GoStreams.Payload"),cache,report,out reused);
            if(verify){
                Console.WriteLine("{\"version\":"+Json(spec.Version)+",\"cache\":"+Json(application)+",\"data\":"+Json(data)+",\"reused\":"+(reused?"true":"false")+",\"files\":"+spec.Files.Count+",\"milliseconds\":"+timer.ElapsedMilliseconds+"}");
                return 0;
            }
            preparing.Close();preparing.Dispose();preparing=null;
            Launcher.Run(args,application,data);
            return 0;
        } catch(OperationCanceledException){return 2;}
        catch(Exception error){
            if(verify)Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message+"\n\nExisting projects and video files were preserved.","Go Streams",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        } finally {if(preparing!=null)preparing.Dispose();}
    }
}
