package dmg
import("archive/zip";"os";"path/filepath";"testing";"unicode/utf16";"github.com/jetbrains/go-dmg-writer/internal/hfsplus")
type zipFixture struct{name,body string;mode os.FileMode}
func openZIPFixture(t *testing.T,items []zipFixture)*zip.ReadCloser{
 t.Helper();p:=filepath.Join(t.TempDir(),"fixture.zip");f,err:=os.Create(p);if err!=nil{t.Fatal(err)};w:=zip.NewWriter(f)
 for _,item:=range items{h:=&zip.FileHeader{Name:item.name};h.SetMode(item.mode);out,err:=w.CreateHeader(h);if err!=nil{t.Fatal(err)};if _,err=out.Write([]byte(item.body));err!=nil{t.Fatal(err)}}
 if err=w.Close();err!=nil{t.Fatal(err)};f.Close();r,err:=zip.OpenReader(p);if err!=nil{t.Fatal(err)};t.Cleanup(func(){r.Close()});return r
}
func TestZIPImportPreservesMacPermissionsAndLinks(t *testing.T){
 z:=openZIPFixture(t,[]zipFixture{{"App.app/Contents/bin","payload",0755},{"App.app/link","Contents/bin",os.ModeSymlink|0777}})
 s,err:=walkZIP(z,1234,99,99,"Test");if err!=nil{t.Fatal(err)}
 executable,link:=false,false
 for _,e:=range s.entries{if string(utf16.Decode(e.Name.Units))=="bin"{executable=e.Mode==0100755};if string(utf16.Decode(e.Name.Units))=="link"{link=e.Kind==hfsplus.KindSymlink&&e.Mode==0120777&&e.SymlinkTarget=="Contents/bin"}}
 if !executable||!link{t.Fatalf("permissions/link not preserved: executable=%v link=%v",executable,link)}
}
func TestZIPImportRejectsTraversalAndUnsafeLinks(t *testing.T){
 cases:=map[string][]zipFixture{
 "traversal":{{"../outside","x",0644}},
 "absolute":{{"/absolute","x",0644}},
 "duplicate":{{"App.app/a","1",0644},{"App.app/a","2",0644}},
 "collision":{{"App.app/dir","file",0644},{"App.app/dir/a","x",0644}},
 "escaping-link":{{"App.app/link","../../outside",os.ModeSymlink|0777}},
 "absolute-link":{{"App.app/link","/etc/passwd",os.ModeSymlink|0777}},
 }
 for name,items:=range cases{t.Run(name,func(t *testing.T){_,err:=walkZIP(openZIPFixture(t,items),1234,99,99,"Test");if err==nil{t.Fatal("unsafe ZIP accepted")}})}
}
