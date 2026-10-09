// Compiled with the Windows .NET Framework compiler into GitNest's private
// runtime directory. Keep the launcher outside the low integrity directory.
// This is a write boundary for build tools, not a sandbox for hostile programs.
export const WINDOWS_ANALYSIS_HOST_SOURCE = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

class AnalysisHost {
  [StructLayout(LayoutKind.Sequential)] struct SidEntry { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int cb; public string reserved, desktop, title;
    public int x, y, width, height, charsX, charsY, fill, flags;
    public short show, reservedSize;
    public IntPtr reservedPointer, stdin, stdout, stderr;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr process, thread; public uint pid, tid;
  }
  [StructLayout(LayoutKind.Sequential)] struct Luid { public uint low; public int high; }
  [StructLayout(LayoutKind.Sequential)] struct Privileges { public uint count; public Luid luid; public uint attributes; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags;
    public UIntPtr minWorkingSet, maxWorkingSet; public uint activeProcesses;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters {
    public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct JobLimits {
    public BasicLimits basic; public IoCounters io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint rights, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr data, int capacity, out int size);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool SetTokenInformation(IntPtr token, int cls, IntPtr data, int size);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool CreateRestrictedToken(IntPtr old, uint flags, uint disableCount, IntPtr disabled, uint privilegeCount, IntPtr privileges, uint count, SidEntry[] sids, out IntPtr token);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disable, ref Privileges privileges, uint size, IntPtr previous, IntPtr returned);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessAsUserW(IntPtr token, string app, StringBuilder cmd, IntPtr ps, IntPtr ts, bool inherit, uint flags, IntPtr env, string cwd, ref Startup startup, out ProcessInfo info);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint GetNamedSecurityInfo(string path, int type, uint flags, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string path, int type, uint flags, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetSecurityDescriptorSacl(IntPtr descriptor, out bool present, out IntPtr acl, out bool defaulted);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref JobLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint time);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);

  static readonly List<IntPtr> allocations = new List<IntPtr>();
  static IntPtr Allocate(int length) {
    IntPtr p = Marshal.AllocHGlobal(length); allocations.Add(p); return p;
  }
  static IntPtr SidPointer(SecurityIdentifier sid) {
    byte[] bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
    IntPtr p = Allocate(bytes.Length); Marshal.Copy(bytes, 0, p, bytes.Length); return p;
  }
  static IntPtr TokenInfo(IntPtr token, int cls) {
    int length; GetTokenInformation(token, cls, IntPtr.Zero, 0, out length);
    if (length <= 0) throw new Win32Exception();
    IntPtr info = Allocate(length);
    if (!GetTokenInformation(token, cls, info, length, out length)) throw new Win32Exception();
    return info;
  }
  static RawAcl ReadAcl(IntPtr pointer) {
    int length = (ushort)Marshal.ReadInt16(pointer, 2);
    byte[] bytes = new byte[length]; Marshal.Copy(pointer, bytes, 0, length);
    return new RawAcl(bytes, 0);
  }
  static void CheckEntry(string path, bool checkIntegrity) {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
      throw new IOException("Isolation cannot admit a reparse point: " + path);
    if (!checkIntegrity) return;
    IntPtr owner, group, dacl, sacl, descriptor;
    uint error = GetNamedSecurityInfo(path, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
    if (error != 0) throw new Win32Exception((int)error, "Cannot check original integrity: " + path);
    try {
      // Unlabelled Windows objects have Medium integrity. Explicit labels
      // must deny write-up and be strictly above the child's Low integrity.
      if (sacl != IntPtr.Zero) {
        RawAcl acl = ReadAcl(sacl);
        foreach (GenericAce ace in acl) {
          if ((int)ace.AceType != 0x11) continue;
          byte[] bytes = new byte[ace.BinaryLength]; ace.GetBinaryForm(bytes, 0);
          int mask = BitConverter.ToInt32(bytes, 4);
          var sid = new SecurityIdentifier(bytes, 8);
          string[] parts = sid.Value.Split('-');
          if (int.Parse(parts[parts.Length - 1]) <= 4096 || (mask & 1) == 0)
            throw new IOException("Original has no Medium write boundary: " + path);
        }
      }
    } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
  }
  static void CheckTree(string root, bool checkIntegrity) {
    CheckEntry(root, checkIntegrity);
    if (!Directory.Exists(root)) return;
    foreach (string path in Directory.EnumerateFileSystemEntries(root)) {
      CheckEntry(path, checkIntegrity);
      if (Directory.Exists(path)) CheckTree(path, checkIntegrity);
    }
  }
  static void CheckParents(string path, bool checkIntegrity) {
    for (string p = path; p != null; p = Path.GetDirectoryName(p)) CheckEntry(p, checkIntegrity);
  }
  static bool Inside(string parent, string child) {
    return child.Equals(parent, StringComparison.OrdinalIgnoreCase) ||
      child.StartsWith(parent.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);
  }
  static void MakePrivate(string root) {
    var access = new DirectorySecurity();
    access.SetAccessRuleProtection(true, false);
    foreach (SecurityIdentifier sid in new[] { WindowsIdentity.GetCurrent().User, new SecurityIdentifier("S-1-5-18") })
      access.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    Directory.SetAccessControl(root, access);
  }
  static void VerifyWritableRoot(string root) {
    var access = Directory.GetAccessControl(root);
    if (!access.AreAccessRulesProtected) throw new IOException("Analysis cache permissions are not private");
    foreach (FileSystemAccessRule rule in access.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
      string sid = rule.IdentityReference.Value;
      if ((sid != WindowsIdentity.GetCurrent().User.Value && sid != "S-1-5-18") ||
          rule.AccessControlType != AccessControlType.Allow ||
          rule.FileSystemRights != FileSystemRights.FullControl ||
          rule.InheritanceFlags != (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit))
        throw new IOException("Analysis cache permissions changed; use a fresh runtime directory");
    }
    IntPtr owner, group, dacl, sacl, descriptor;
    uint error = GetNamedSecurityInfo(root, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
    if (error != 0) throw new Win32Exception((int)error);
    try {
      if (sacl != IntPtr.Zero) foreach (GenericAce ace in ReadAcl(sacl)) {
        if ((int)ace.AceType != 0x11) continue;
        byte[] bytes = new byte[ace.BinaryLength]; ace.GetBinaryForm(bytes, 0);
        if (new SecurityIdentifier(bytes, 8).Value == "S-1-16-4096" &&
            (BitConverter.ToInt32(bytes, 4) & 1) != 0 &&
            (ace.AceFlags & (AceFlags.ContainerInherit | AceFlags.ObjectInherit)) ==
              (AceFlags.ContainerInherit | AceFlags.ObjectInherit)) return;
      }
      throw new IOException("Analysis cache integrity changed; use a fresh runtime directory");
    } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
  }
  static void MakeWritable(string root) {
    // Only our managed copy receives ACL/label changes.
    IntPtr descriptor; uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NW;;;LW)", 1, out descriptor, out size))
      throw new Win32Exception();
    try {
      bool present, defaulted; IntPtr acl;
      if (!GetSecurityDescriptorSacl(descriptor, out present, out acl, out defaulted)) throw new Win32Exception();
      uint error = SetNamedSecurityInfo(root, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, acl);
      if (error != 0) throw new Win32Exception((int)error, "Cannot label analysis copy");
    } finally { LocalFree(descriptor); }
  }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char ch in value) {
      if (ch == '\\') { slashes++; continue; }
      if (ch == '"') { text.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
      text.Append('\\', slashes).Append(ch); slashes = 0;
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  static int Main(string[] args) {
    IntPtr original = IntPtr.Zero, token = IntPtr.Zero, job = IntPtr.Zero, ownerProcess = IntPtr.Zero;
    ProcessInfo process = new ProcessInfo();
    try {
      AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
      AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
      if (args.Length == 2 && args[0] == "--prepare") {
        string directory = Path.GetFullPath(args[1]);
        CheckParents(directory, false); CheckTree(directory, false);
        if (Directory.GetFileSystemEntries(directory).Length == 0) {
          MakePrivate(directory); MakeWritable(directory);
        } else VerifyWritableRoot(directory);
        return 0;
      }
      string root = Path.GetFullPath(args[0]), cwd = Path.GetFullPath(args[1]);
      ownerProcess = OpenProcess(0x00100000, false, uint.Parse(args[2]));
      if (ownerProcess == IntPtr.Zero) throw new Win32Exception();
      int count = int.Parse(args[3]), commandIndex = 4 + count;
      if (count <= 0 || !Inside(root, cwd)) throw new IOException("Invalid isolation roots");
      CheckParents(root, false); CheckTree(root, false);
      for (int i = 0; i < count; i++) {
        string source = Path.GetFullPath(args[4 + i]);
        if (Inside(source, root) || Inside(root, source)) throw new IOException("Copy overlaps original");
        CheckParents(source, true); CheckTree(source, true);
      }
      // Never relabel existing descendants: a build tool may have hard-linked
      // a dependency. Changing that link's ACL or MIC would affect its source.
      VerifyWritableRoot(root);
      if (!OpenProcessToken(GetCurrentProcess(), 0xAB, out original)) throw new Win32Exception();
      IntPtr logonInfo = TokenInfo(original, 28);
      if (Marshal.ReadInt32(logonInfo) != 1) throw new IOException("Missing logon SID");
      SidEntry logonEntry = (SidEntry)Marshal.PtrToStructure(IntPtr.Add(logonInfo, IntPtr.Size), typeof(SidEntry));
      var logon = new SecurityIdentifier(logonEntry.Sid);
      var entries = new[] {
        new SidEntry { Sid = SidPointer(logon) },
        new SidEntry { Sid = SidPointer(new SecurityIdentifier("S-1-1-0")) },
        new SidEntry { Sid = SidPointer(WindowsIdentity.GetCurrent().User) }
      };
      // DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED. Never SANDBOX_INERT.
      if (!CreateRestrictedToken(original, 0x0D, 0, IntPtr.Zero, 0, IntPtr.Zero, (uint)entries.Length, entries, out token))
        throw new Win32Exception();
      var lowSid = new SecurityIdentifier("S-1-16-4096");
      var integrity = new SidEntry { Sid = SidPointer(lowSid), Attributes = 0x20 };
      IntPtr integrityInfo = Allocate(Marshal.SizeOf(integrity));
      Marshal.StructureToPtr(integrity, integrityInfo, false);
      if (!SetTokenInformation(token, 25, integrityInfo, Marshal.SizeOf(integrity) + lowSid.BinaryLength)) throw new Win32Exception();
      IntPtr daclInfo = TokenInfo(token, 6);
      var defaultAcl = ReadAcl(Marshal.ReadIntPtr(daclInfo));
      defaultAcl.InsertAce(defaultAcl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000, logon, false, null));
      byte[] aclBytes = new byte[defaultAcl.BinaryLength]; defaultAcl.GetBinaryForm(aclBytes, 0);
      IntPtr updatedAcl = Allocate(aclBytes.Length); Marshal.Copy(aclBytes, 0, updatedAcl, aclBytes.Length);
      Marshal.WriteIntPtr(daclInfo, updatedAcl);
      if (!SetTokenInformation(token, 6, daclInfo, IntPtr.Size)) throw new Win32Exception();
      var privilege = new Privileges { count = 1, attributes = 2 };
      if (!LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out privilege.luid) ||
          !AdjustTokenPrivileges(token, false, ref privilege, 0, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
      job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) throw new Win32Exception();
      var limits = new JobLimits(); limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE, no breakaway.
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception();
      var startup = new Startup { flags = 0x100, stdin = GetStdHandle(-10), stdout = GetStdHandle(-11), stderr = GetStdHandle(-12) };
      startup.cb = Marshal.SizeOf(startup);
      foreach (IntPtr handle in new[] { startup.stdin, startup.stdout, startup.stderr })
        if (!SetHandleInformation(handle, 1, 1)) throw new Win32Exception();
      var command = new StringBuilder(Quote(args[commandIndex]));
      for (int i = commandIndex + 1; i < args.Length; i++) command.Append(" ").Append(Quote(args[i]));
      // Suspended creation makes assignment atomic with respect to build children.
      if (!CreateProcessAsUserW(token, args[commandIndex], command, IntPtr.Zero, IntPtr.Zero, true,
          0x08000004, IntPtr.Zero, cwd, ref startup, out process)) throw new Win32Exception();
      if (!AssignProcessToJobObject(job, process.process)) throw new Win32Exception();
      if (ResumeThread(process.thread) == 0xFFFFFFFF) throw new Win32Exception();
      uint wait = WaitForMultipleObjects(2, new[] { process.process, ownerProcess }, false, 0xFFFFFFFF);
      if (wait != 0) return 127; // Owner exited: finally closes the entire build job.
      uint code; if (!GetExitCodeProcess(process.process, out code)) throw new Win32Exception();
      return (int)code;
    } catch (Exception error) {
      Console.Error.WriteLine("GitNest isolation refused: " + error.Message);
      return 127;
    } finally {
      if (process.process != IntPtr.Zero) { TerminateProcess(process.process, 127); CloseHandle(process.process); }
      if (process.thread != IntPtr.Zero) CloseHandle(process.thread);
      if (job != IntPtr.Zero) CloseHandle(job);
      if (ownerProcess != IntPtr.Zero) CloseHandle(ownerProcess);
      if (token != IntPtr.Zero) CloseHandle(token);
      if (original != IntPtr.Zero) CloseHandle(original);
      foreach (IntPtr pointer in allocations) Marshal.FreeHGlobal(pointer);
    }
  }
}
`;
