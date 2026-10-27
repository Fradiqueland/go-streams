// Native entry point for the self-contained Go Streams macOS application.
package main

import (
 "fmt"
 "os"
 "os/exec"
 "path/filepath"
 "runtime"
)

type launchPlan struct { node, server, directory string }

func plan(executable, architecture string) (launchPlan, error) {
 var target string
 switch architecture {
 case "amd64": target = "x64"
 case "arm64": target = "arm64"
 default: return launchPlan{}, fmt.Errorf("Unsupported Mac processor: %s", architecture)
 }
 base := filepath.Clean(filepath.Join(filepath.Dir(executable), "..", "Resources", "app"))
 p := launchPlan{filepath.Join(base, "runtime", "darwin-"+target, "node"), filepath.Join(base, "src", "server.mjs"), base}
 for _, file := range []string{p.node, p.server} {
  info, err := os.Stat(file)
  if err != nil || !info.Mode().IsRegular() { return launchPlan{}, fmt.Errorf("The complete GoStreams.app is required. Missing file: %s", file) }
  if file == p.node && runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0 { return launchPlan{}, fmt.Errorf("The bundled runtime has lost its execute permission. Extract the original Mac ZIP on a Mac: %s", file) }
 }
 return p, nil
}

func command(p launchPlan) *exec.Cmd {
 cmd := exec.Command(p.node, p.server, "--open")
 cmd.Dir = p.directory
 cmd.Env = os.Environ()
 cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
 return cmd
}

func main() {
 executable, err := os.Executable()
 if err == nil {
  // Resolve aliases to the executable while keeping the app fully relocatable.
  if resolved, e := filepath.EvalSymlinks(executable); e == nil { executable = resolved }
  var p launchPlan
  p, err = plan(executable, runtime.GOARCH)
  if err == nil { err = command(p).Run() }
 }
 if err != nil {
  fmt.Fprintln(os.Stderr, "Go Streams:", err)
  if runtime.GOOS == "darwin" {
   script := `function run(argv){var app=Application.currentApplication();app.includeStandardAdditions=true;app.displayAlert("Go Streams",{message:argv[0]});}`
   _ = exec.Command("/usr/bin/osascript", "-l", "JavaScript", "-e", script, "--", err.Error()).Run()
  }
  os.Exit(1)
 }
}
