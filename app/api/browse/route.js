import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function GET(request) {
  try {
    const type = new URL(request.url).searchParams.get('type') === 'file' ? 'file' : 'dir';
    const script = type === 'file' ? `
      Add-Type -AssemblyName System.Windows.Forms
      $dialog = New-Object System.Windows.Forms.OpenFileDialog
      $dialog.Title = "Select a file"
      $dialog.CheckFileExists = $true
      $dialog.Multiselect = $false
      if ($dialog.ShowDialog() -eq 'OK') {
        $dialog.FileName
      } else {
        throw "cancelled"
      }
    ` : `
      Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
class FileOpenDialogRCW {}

[ComImport]
[Guid("42f85136-db7e-439c-85f1-e4075d135fc8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileDialog {
  [PreserveSig] int Show(IntPtr hwndOwner);
  void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
  void SetFileTypeIndex(uint iFileType);
  void GetFileTypeIndex(out uint piFileType);
  void Advise(IntPtr pfde, out uint pdwCookie);
  void Unadvise(uint dwCookie);
  void SetOptions(uint fos);
  void GetOptions(out uint pfos);
  void SetDefaultFolder(IShellItem psi);
  void SetFolder(IShellItem psi);
  void GetFolder(out IShellItem ppsi);
  void GetCurrentSelection(out IShellItem ppsi);
  void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
  void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
  void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
  void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
  void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
  void GetResult(out IShellItem ppsi);
  void AddPlace(IShellItem psi, int fdap);
  void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
  void Close(int hr);
  void SetClientGuid(ref Guid guid);
  void ClearClientData();
  void SetFilter(IntPtr pFilter);
}

[ComImport]
[Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
  void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
  void GetParent(out IShellItem ppsi);
  void GetDisplayName(uint sigdnName, out IntPtr ppszName);
  void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
  void Compare(IShellItem psi, uint hint, out int piOrder);
}

public static class WindowsFolderPicker {
  const uint FOS_PICKFOLDERS = 0x20;
  const uint FOS_FORCEFILESYSTEM = 0x40;
  const uint FOS_NOCHANGEDIR = 0x8;
  const uint FOS_PATHMUSTEXIST = 0x800;
  const uint SIGDN_FILESYSPATH = 0x80058000;

  public static string Show() {
    var dialog = (IFileDialog)new FileOpenDialogRCW();
    uint options;
    dialog.GetOptions(out options);
    dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_PATHMUSTEXIST);
    dialog.SetTitle("Open Folder");
    dialog.SetOkButtonLabel("Select folder");

    int result = dialog.Show(IntPtr.Zero);
    if (result == unchecked((int)0x800704C7)) return null;
    if (result != 0) Marshal.ThrowExceptionForHR(result);

    IShellItem item;
    dialog.GetResult(out item);
    IntPtr pathPointer;
    item.GetDisplayName(SIGDN_FILESYSPATH, out pathPointer);
    try {
      return Marshal.PtrToStringUni(pathPointer);
    } finally {
      Marshal.FreeCoTaskMem(pathPointer);
    }
  }
}
"@
      $selectedPath = [WindowsFolderPicker]::Show()
      if ($selectedPath) {
        $selectedPath
      } else {
        throw "cancelled"
      }
    `;
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-STA', '-Command', script], {
      timeout: 120000,
      windowsHide: true
    });
    const selectedPath = stdout.trim();
    if (!selectedPath) {
      return NextResponse.json({ error: `No ${type === 'file' ? 'file' : 'folder'} selected` }, { status: 400 });
    }
    return NextResponse.json({ path: selectedPath });
  } catch (error) {
    if (error.message?.includes('cancelled')) {
      return NextResponse.json({ error: 'cancelled' }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
