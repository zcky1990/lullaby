async function run(command: string, args: string[]): Promise<string | null> {
  try {
    const out = await new Deno.Command(command, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (out.code !== 0) return null;
    const value = new TextDecoder().decode(out.stdout).trim().replace(/\/+$/, "");
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function pickDirectory(title = "Pilih workspace"): Promise<string | null> {
  switch (Deno.build.os) {
    case "darwin":
      return await run("osascript", [
        "-e",
        `POSIX path of (choose folder with prompt "${title}")`,
      ]);
    case "windows": {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
        `$d.Description = "${title}"`,
        "if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
      ].join("; ");
      return await run("powershell", ["-NoProfile", "-Command", script]);
    }
    default:
      return await run("zenity", ["--file-selection", "--directory", `--title=${title}`]);
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}
