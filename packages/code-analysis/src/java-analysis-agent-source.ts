export const JAVA_ANALYSIS_AGENT_SOURCE = String.raw`
package gitnest.analysis;

import java.io.*;
import java.lang.instrument.*;
import java.lang.reflect.Field;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.*;
import java.util.*;
import java.util.jar.*;
import org.objectweb.asm.*;

public final class AnalysisAgent {
  private static Path runtime;
  private static final List<Path> roots = new ArrayList<>();
  private static final Map<String, Map<String, Path>> outputs = new HashMap<>();
  private static final Set<String> mavenRepositories = new LinkedHashSet<>();
  private static long metadataBytes;
  private static int metadataFiles;
  private static final String LIFECYCLE = "org/eclipse/m2e/core/project/configurator/AbstractLifecycleMapping";
  private static final String CONFIGURATOR = "org/eclipse/m2e/jdt/internal/AbstractJavaProjectConfigurator";
  private static final String FILESYSTEM = "org/eclipse/jdt/ls/core/internal/filesystem/JLSFsUtils";
  private static final String APT = "org/eclipse/jdt/apt/core/util/AptConfig";
  private static final String MAVEN_CONTEXT = "org/eclipse/m2e/core/internal/embedder/MavenExecutionContext";
  private static final String GRADLE_ARGUMENTS = "org/eclipse/buildship/core/internal/configuration/GradleArguments";
  private static final String GRADLE_OUTPUT = "org/eclipse/buildship/core/internal/workspace/OutputLocationUpdater";
  private static final String GRADLE_SOURCE = "org/eclipse/buildship/core/internal/workspace/SourceFolderUpdater$SourceFolderEntryBuilder";
  private static final String GRADLE_SUPPORT = "org/eclipse/jdt/ls/core/internal/managers/GradleBuildSupport";
  private static final String FILE_DETECTOR = "org/eclipse/jdt/ls/core/internal/managers/BasicFileDetector";
  private static final String SELF = "gitnest/analysis/AnalysisAgent";

  public static void premain(String config, Instrumentation instrumentation) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(config), StandardCharsets.UTF_8);
    if (lines.size() < 2) throw new IOException("Missing protected project roots");
    runtime = Paths.get(lines.get(0)).toRealPath();
    for (String line : lines.subList(1, lines.size())) {
      Path root = Paths.get(line).toRealPath();
      if (root.startsWith(runtime) || runtime.startsWith(root)) throw new IOException("Overlapping analysis roots");
      roots.add(root);
    }
    instrumentation.addTransformer(new ClassFileTransformer() {
      public byte[] transform(ClassLoader loader, String name, Class<?> type, ProtectionDomain domain, byte[] bytes) {
        try { return transformClass(name, bytes); }
        catch (Throwable failure) {
          System.err.println("GitNest Java isolation incompatible: " + failure);
          Runtime.getRuntime().halt(127);
          return null;
        }
      }
    });
  }

  private static byte[] transformClass(String type, byte[] bytes) throws IOException {
    if (!Arrays.asList(LIFECYCLE, CONFIGURATOR, FILESYSTEM, APT, MAVEN_CONTEXT, GRADLE_ARGUMENTS, GRADLE_OUTPUT, GRADLE_SOURCE, GRADLE_SUPPORT, FILE_DETECTOR).contains(type)) return null;
    final int[] matches = new int[4];
    ClassReader reader = new ClassReader(bytes);
    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
    reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
      public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        MethodVisitor original = super.visitMethod(access, name, descriptor, signature, exceptions);
        if (type.equals(FILE_DETECTOR) && name.equals("addExclusions") &&
            descriptor.equals("([Ljava/lang/String;)Lorg/eclipse/jdt/ls/core/internal/managers/BasicFileDetector;")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 1);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "projectExclusions", "([Ljava/lang/String;)[Ljava/lang/String;", false);
              super.visitVarInsn(Opcodes.ASTORE, 1);
            }
          };
        }
        if (type.equals(GRADLE_SUPPORT)) {
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitMethodInsn(int opcode, String owner, String method, String desc, boolean itf) {
              if (opcode == Opcodes.INVOKEINTERFACE &&
                  (owner.equals("org/gradle/tooling/ModelBuilder") || owner.equals("org/gradle/tooling/BuildLauncher")) &&
                  method.equals("withArguments") && desc.equals("([Ljava/lang/String;)Lorg/gradle/tooling/ConfigurableLauncher;")) {
                matches[0]++;
                method = "addArguments";
              }
              super.visitMethodInsn(opcode, owner, method, desc, itf);
            }
          };
        }
        if (type.equals(GRADLE_ARGUMENTS) && name.equals("from") &&
            descriptor.equals("(Ljava/io/File;Lorg/eclipse/buildship/core/GradleDistribution;Ljava/io/File;Ljava/io/File;ZZLjava/util/List;Ljava/util/List;)Lorg/eclipse/buildship/core/internal/configuration/GradleArguments;")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              for (int index = 6; index <= 7; index++) {
                super.visitVarInsn(Opcodes.ALOAD, index);
                super.visitInsn(index == 7 ? Opcodes.ICONST_1 : Opcodes.ICONST_0);
                super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "gradleArguments", "(Ljava/util/List;Z)Ljava/util/List;", false);
                super.visitVarInsn(Opcodes.ASTORE, index);
              }
            }
          };
        }
        if (type.equals(GRADLE_OUTPUT) && name.equals("update") &&
            descriptor.equals("(Lorg/eclipse/buildship/core/ProjectContext;Lorg/eclipse/jdt/core/IJavaProject;Lorg/gradle/tooling/model/eclipse/EclipseProject;Lorg/eclipse/core/runtime/IProgressMonitor;)V")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitMethodInsn(int opcode, String owner, String method, String desc, boolean itf) {
              super.visitMethodInsn(opcode, owner, method, desc, itf);
              if (owner.equals("org/gradle/tooling/model/eclipse/EclipseOutputLocation") &&
                  method.equals("getPath") && desc.equals("()Ljava/lang/String;")) {
                matches[1]++;
                super.visitInsn(Opcodes.POP);
                super.visitVarInsn(Opcodes.ALOAD, 1);
                super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "gradleOutputName", "(Ljava/lang/Object;)Ljava/lang/String;", false);
              }
            }
          };
        }
        if (type.equals(GRADLE_SOURCE) && name.equals("setOutput") && descriptor.equals("(Ljava/lang/String;)V")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 0);
              super.visitFieldInsn(Opcodes.GETFIELD, GRADLE_SOURCE, "project", "Lorg/eclipse/jdt/core/IJavaProject;");
              super.visitVarInsn(Opcodes.ALOAD, 1);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "gradleSourceOutput", "(Ljava/lang/Object;Ljava/lang/String;)Ljava/lang/String;", false);
              super.visitVarInsn(Opcodes.ASTORE, 1);
            }
          };
        }
        if (type.equals(MAVEN_CONTEXT) && name.equals("createRepositorySession") &&
            descriptor.equals("(Lorg/apache/maven/execution/MavenExecutionRequest;Lorg/eclipse/m2e/core/embedder/IMavenConfiguration;Lorg/eclipse/m2e/core/embedder/IComponentLookup;)Lorg/eclipse/m2e/core/internal/embedder/FilterRepositorySystemSession;")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 0);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "configureRepository", "(Ljava/lang/Object;)V", false);
            }
          };
        }
        if (type.equals(MAVEN_CONTEXT) && name.equals("getLocalRepositoryPath") &&
            descriptor.equals("(Lorg/apache/maven/settings/Settings;Ljava/io/File;)Ljava/io/File;")) {
          matches[1]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitInsn(int opcode) {
              if (opcode == Opcodes.ARETURN) {
                super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "mavenRepository", "(Ljava/io/File;)Ljava/io/File;", false);
              }
              super.visitInsn(opcode);
            }
          };
        }
        if (type.equals(LIFECYCLE) && name.equals("configure") &&
            descriptor.equals("(Lorg/eclipse/m2e/core/project/configurator/ProjectConfigurationRequest;Lorg/eclipse/core/runtime/IProgressMonitor;)V")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 1);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "prepareModel", "(Ljava/lang/Object;)V", false);
            }
          };
        }
        if (type.equals(CONFIGURATOR) && name.equals("getFolder") &&
            descriptor.equals("(Lorg/eclipse/core/resources/IProject;Ljava/lang/String;)Lorg/eclipse/core/resources/IContainer;")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 1);
              super.visitVarInsn(Opcodes.ALOAD, 2);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "outputFolder", "(Ljava/lang/Object;Ljava/lang/String;)Ljava/lang/Object;", false);
              Label fallback = new Label();
              super.visitInsn(Opcodes.DUP);
              super.visitJumpInsn(Opcodes.IFNULL, fallback);
              super.visitTypeInsn(Opcodes.CHECKCAST, "org/eclipse/core/resources/IContainer");
              super.visitInsn(Opcodes.ARETURN);
              super.visitLabel(fallback);
              super.visitFrame(Opcodes.F_SAME1, 0, null, 1, new Object[] { "java/lang/Object" });
              super.visitInsn(Opcodes.POP);
            }
          };
        }
        if (type.equals(FILESYSTEM) && name.equals("shouldStoreInMetadataArea") &&
            descriptor.equals("(Lorg/eclipse/core/runtime/IPath;)Z")) {
          matches[0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitMethodInsn(int opcode, String owner, String method, String desc, boolean itf) {
              if (opcode == Opcodes.INVOKEVIRTUAL && owner.equals("java/io/File") &&
                  method.equals("exists") && desc.equals("()Z")) {
                matches[2]++;
                super.visitInsn(Opcodes.POP);
                super.visitInsn(Opcodes.ICONST_0);
              } else super.visitMethodInsn(opcode, owner, method, desc, itf);
            }
          };
        }
        if (type.equals(FILESYSTEM) && name.equals("getMetaDataFilePath") &&
            descriptor.equals("(Ljava/lang/String;Lorg/eclipse/core/runtime/IPath;)Lorg/eclipse/core/runtime/IPath;")) {
          matches[1]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitInsn(int opcode) {
              if (opcode == Opcodes.ARETURN) {
                matches[3]++;
                super.visitInsn(Opcodes.DUP);
                super.visitVarInsn(Opcodes.ALOAD, 0);
                super.visitLdcInsn(Type.getObjectType(FILESYSTEM));
                super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "seedMetadata",
                    "(Ljava/lang/Object;Ljava/lang/String;Ljava/lang/Class;)V", false);
              }
              super.visitInsn(opcode);
            }
          };
        }
        if (type.equals(APT) && (name.equals("setGenSrcDir") || name.equals("setGenTestSrcDir")) &&
            descriptor.equals("(Lorg/eclipse/jdt/core/IJavaProject;Ljava/lang/String;)V")) {
          final boolean test = name.equals("setGenTestSrcDir");
          matches[test ? 1 : 0]++;
          return new MethodVisitor(Opcodes.ASM9, original) {
            public void visitCode() {
              super.visitCode();
              super.visitVarInsn(Opcodes.ALOAD, 0);
              super.visitVarInsn(Opcodes.ALOAD, 1);
              super.visitInsn(test ? Opcodes.ICONST_1 : Opcodes.ICONST_0);
              super.visitMethodInsn(Opcodes.INVOKESTATIC, SELF, "generatedSources",
                  "(Ljava/lang/Object;Ljava/lang/String;Z)Ljava/lang/String;", false);
              super.visitVarInsn(Opcodes.ASTORE, 1);
            }
          };
        }
        return original;
      }
    }, 0);
    if (matches[0] != (type.equals(GRADLE_SUPPORT) ? 2 : 1) ||
        ((type.equals(APT) || type.equals(GRADLE_OUTPUT) || type.equals(MAVEN_CONTEXT)) && matches[1] != 1) ||
        (type.equals(FILESYSTEM) && (matches[1] != 1 || matches[2] != 2 || matches[3] != 4))) {
      throw new IOException("Unsupported language server API: " + type + " " + Arrays.toString(matches));
    }
    return writer.toByteArray();
  }

  private static String key(Path path) {
    return path.toAbsolutePath().normalize().toString().toLowerCase(Locale.ROOT);
  }

  public static String[] projectExclusions(String[] patterns) throws Exception {
    if (patterns == null) return null;
    String[] result = patterns.clone();
    for (int index = 0; index < result.length; index++) {
      String pattern = result[index];
      if (pattern == null || pattern.startsWith("!") || pattern.indexOf('*') >= 0 || pattern.indexOf('?') >= 0) continue;
      try {
        Path path = Paths.get(pattern.replace("\\\\", "\\"));
        if (!path.isAbsolute()) continue;
        Path actual = path.toRealPath();
        if (!Files.isRegularFile(runtime.resolve("generated-origins").resolve(digest(key(actual))))) continue;
        // Imported project locations are literal paths, not user glob expressions.
        StringBuilder escaped = new StringBuilder();
        for (char character : path.normalize().toString().replace('\\', '/').toCharArray()) {
          if ("\\*?[]{}".indexOf(character) >= 0) escaped.append('\\');
          escaped.append(character);
        }
        result[index] = escaped.toString();
      } catch (InvalidPathException | IOException ignored) { }
    }
    return result;
  }

  private static String digest(String value) throws Exception {
    byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
    StringBuilder text = new StringBuilder();
    for (byte b : bytes) text.append(String.format("%02x", b & 255));
    return text.toString();
  }

  private static Path admitted(Path path) throws IOException {
    Path actual = path.toRealPath();
    for (Path root : roots) if (actual.startsWith(root)) return actual;
    throw new IOException("Project is outside protected roots: " + path);
  }

  private static Path projectLocation(Object project) throws Exception {
    Object location = project.getClass().getMethod("getLocation").invoke(project);
    return ((File) location.getClass().getMethod("toFile").invoke(location)).toPath();
  }

  private static Path outputRoot(Path source) throws Exception {
    String id = digest(key(source));
    Path origins = Files.createDirectories(runtime.resolve("generated-origins"));
    Path record = origins.resolve(id);
    if (!Files.exists(record)) Files.writeString(record, source.toString(), StandardOpenOption.CREATE_NEW);
    return runtime.resolve("java-output").resolve(id);
  }

  public static synchronized File mavenRepository(File original) {
    String head = System.getProperty("maven.repo.local.head");
    if (head == null) throw new IllegalStateException("Missing private Maven repository");
    Path target = Paths.get(head).toAbsolutePath().normalize();
    if (original != null) {
      Path existing = original.toPath().toAbsolutePath().normalize();
      if (!existing.startsWith(runtime) && !existing.equals(target) && Files.isDirectory(existing)) {
        mavenRepositories.add(existing.toString());
      }
    }
    return target.toFile();
  }

  public static synchronized void configureRepository(Object request) {
    try {
      Properties properties = (Properties) request.getClass().getMethod("getUserProperties").invoke(request);
      for (String name : Arrays.asList("maven.repo.local.head", "maven.repo.local.tail", "maven.repo.local.tail.ignoreAvailability")) {
        String value = System.getProperty(name);
        if (value == null && name.endsWith(".head")) throw new IOException("Missing private Maven repository");
        if (value != null) properties.setProperty(name, value);
      }
      Set<String> repositories = new LinkedHashSet<>(mavenRepositories);
      String tail = System.getProperty("maven.repo.local.tail");
      if (tail != null) repositories.addAll(Arrays.asList(tail.split(",")));
      if (!repositories.isEmpty()) properties.setProperty("maven.repo.local.tail", String.join(",", repositories));
    } catch (Exception failure) { throw new IllegalStateException("GitNest Maven repository isolation failed", failure); }
  }

  public static List<String> gradleArguments(List<String> original, boolean jvm) {
    List<String> result = new ArrayList<>(original == null ? Collections.emptyList() : original);
    if (jvm) {
      result.removeIf(value -> value.startsWith("-Dgitnest.analysis.run="));
      result.add("-Dgitnest.analysis.run=" + runtime);
    } else {
      for (int index = 0; index < result.size();) {
        if (result.get(index).equals("--project-cache-dir")) {
          result.remove(index);
          if (index < result.size()) result.remove(index);
        } else if (result.get(index).startsWith("--project-cache-dir=")) result.remove(index);
        else index++;
      }
      String script = runtime.resolve("data/gradle-init.gradle").toString();
      if (!result.contains(script)) { result.add("--init-script"); result.add(script); }
      result.add("--project-cache-dir");
      result.add(runtime.resolve("data/gradle-project-cache").toString());
    }
    return result;
  }

  public static String gradleOutputName(Object javaProject) {
    try {
      Object project = javaProject.getClass().getMethod("getProject").invoke(javaProject);
      Path source = admitted(projectLocation(project));
      Path output = outputRoot(source).resolve("gradle-classes");
      String name = ".gitnest-output-" + digest(key(output));
      linkedFolder(project, output, name);
      return name;
    } catch (Exception failure) { throw new IllegalStateException("GitNest Gradle output isolation failed", failure); }
  }

  public static String gradleSourceOutput(Object javaProject, String requested) {
    if (javaProject == null || requested == null) return requested;
    try {
      Object project = javaProject.getClass().getMethod("getProject").invoke(javaProject);
      Path source = admitted(projectLocation(project));
      Path output = outputRoot(source).resolve("gradle-source-outputs").resolve(digest(requested.toLowerCase(Locale.ROOT)));
      String name = ".gitnest-output-" + digest(key(output));
      linkedFolder(project, output, name);
      return name;
    } catch (Exception failure) { throw new IllegalStateException("GitNest Gradle source output isolation failed", failure); }
  }

  public static synchronized void prepareModel(Object request) {
    try {
      Object project = request.getClass().getMethod("mavenProject").invoke(request);
      Path source = admitted(((File) project.getClass().getMethod("getBasedir").invoke(project)).toPath());
      Object build = project.getClass().getMethod("getBuild").invoke(project);
      if (!"pom".equals(project.getClass().getMethod("getPackaging").invoke(project))) {
        for (String[] sourceProperty : new String[][] {
            { "SourceDirectory", "CompileSourceRoots", "addCompileSourceRoot" },
            { "TestSourceDirectory", "TestCompileSourceRoots", "addTestCompileSourceRoot" } }) {
          List<?> sourcePaths = (List<?>) project.getClass().getMethod("get" + sourceProperty[1]).invoke(project);
          String configured = (String) build.getClass().getMethod("get" + sourceProperty[0]).invoke(build);
          if (sourcePaths.isEmpty() && configured != null && Files.isDirectory(Paths.get(configured))) {
            admitted(Paths.get(configured));
            project.getClass().getMethod(sourceProperty[2], String.class).invoke(project, configured);
          }
        }
      }
      Path output = outputRoot(source);
      Map<String, Path> locations = outputs.computeIfAbsent(key(source), ignored -> new HashMap<>());
      for (String[] property : new String[][] {
          { "OutputDirectory", "classes" }, { "TestOutputDirectory", "test-classes" } }) {
        Path target = Files.createDirectories(output.resolve(property[1]));
        String previous = (String) build.getClass().getMethod("get" + property[0]).invoke(build);
        locations.put(key(Paths.get(previous)), target);
        locations.put(key(target), target);
        build.getClass().getMethod("set" + property[0], String.class).invoke(build, target.toString());
      }
      build.getClass().getMethod("setDirectory", String.class).invoke(build, output.toString());
    } catch (Exception failure) { throw new IllegalStateException("GitNest Maven output isolation failed", failure); }
  }

  private static Object linkedFolder(Object project, Path target, String name) throws Exception {
    Files.createDirectories(target);
    Object folder = project.getClass().getMethod("getFolder", String.class).invoke(project, name);
    if (!(Boolean) folder.getClass().getMethod("exists").invoke(folder)) {
      Class<?> monitor = folder.getClass().getClassLoader().loadClass("org.eclipse.core.runtime.IProgressMonitor");
      folder.getClass().getMethod("createLink", URI.class, int.class, monitor).invoke(folder, target.toUri(), 256, null);
    }
    URI actual = (URI) folder.getClass().getMethod("getLocationURI").invoke(folder);
    if (actual == null || !Paths.get(actual).equals(target)) throw new IOException("Analysis resource name collision");
    return folder;
  }

  public static synchronized Object outputFolder(Object project, String location) {
    try {
      Path source = admitted(projectLocation(project));
      Map<String, Path> locations = outputs.get(key(source));
      Path target = locations == null ? null : locations.get(key(Paths.get(location)));
      if (target == null) return null;
      return linkedFolder(project, target, ".gitnest-output-" + digest(key(target)));
    } catch (Exception failure) { throw new IllegalStateException("GitNest output resource isolation failed", failure); }
  }

  public static synchronized String generatedSources(Object javaProject, String original, boolean test) {
    if (javaProject == null) return original;
    try {
      Object project = javaProject.getClass().getMethod("getProject").invoke(javaProject);
      Path location = projectLocation(project).toAbsolutePath().normalize();
      if (location.startsWith(runtime)) return original;
      Path source = admitted(location);
      Path target = outputRoot(source).resolve(test ? "generated-test" : "generated-main");
      String name = ".gitnest-generated-" + digest(key(target));
      linkedFolder(project, target, name);
      return name;
    } catch (Exception failure) { throw new IllegalStateException("GitNest generated-source isolation failed", failure); }
  }

  public static synchronized void seedMetadata(Object path, String projectName, Class<?> filesystem) {
    if (path == null) return;
    try {
      Path destination = ((File) path.getClass().getMethod("toFile").invoke(path)).toPath().toAbsolutePath().normalize();
      if (!destination.startsWith(runtime)) throw new IOException("Metadata is outside the private runtime");
      if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)) return;
      Class<?> resources = filesystem.getClassLoader().loadClass("org.eclipse.core.resources.ResourcesPlugin");
      Object workspace = resources.getMethod("getWorkspace").invoke(null);
      Object root = workspace.getClass().getMethod("getRoot").invoke(workspace);
      Object project = root.getClass().getMethod("getProject", String.class).invoke(root, projectName);
      Object location = project.getClass().getMethod("getLocation").invoke(project);
      if (location == null) return;
      Path source = ((File) location.getClass().getMethod("toFile").invoke(location)).toPath().toAbsolutePath().normalize();
      if (source.startsWith(runtime)) return;
      source = admitted(source);
      Field field = filesystem.getDeclaredField("METADATA_FOLDER_PATH");
      field.setAccessible(true);
      Object metadataPath = field.get(null);
      Path metadataRoot = ((File) metadataPath.getClass().getMethod("toFile").invoke(metadataPath)).toPath();
      Path relative = metadataRoot.resolve(projectName).relativize(destination);
      String first = relative.getName(0).toString();
      if (!Arrays.asList(".project", ".classpath", ".factorypath", ".settings").contains(first) ||
          relative.startsWith("..")) throw new IOException("Unexpected metadata path");
      preserveMetadata(source.resolve(relative), destination, source);
    } catch (Exception failure) { throw new IllegalStateException("GitNest private metadata initialization failed", failure); }
  }

  private static void preserveMetadata(Path source, Path destination, Path project) throws IOException {
    if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS) || !Files.exists(source, LinkOption.NOFOLLOW_LINKS)) return;
    BasicFileAttributes attributes = Files.readAttributes(source, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    if (attributes.isSymbolicLink() || attributes.isOther() || !source.toRealPath().equals(source.toAbsolutePath().normalize()))
      throw new IOException("Linked project metadata is not supported: " + source);
    if (!source.toRealPath().startsWith(project)) throw new IOException("Metadata escapes its project");
    if (attributes.isDirectory()) {
      Files.createDirectories(destination);
      try (DirectoryStream<Path> entries = Files.newDirectoryStream(source)) {
        for (Path entry : entries) preserveMetadata(entry, destination.resolve(entry.getFileName()), project);
      }
    } else {
      if (++metadataFiles > 4096 || (metadataBytes += attributes.size()) > 16 * 1024 * 1024)
        throw new IOException("Project configuration exceeds 4096 files or 16 MiB");
      Files.createDirectories(destination.getParent());
      try (InputStream input = Files.newInputStream(source);
           OutputStream output = Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW)) {
        input.transferTo(output);
      }
    }
  }

  public static void main(String[] args) throws Exception {
    Set<String> remaining = new HashSet<>(Arrays.asList(LIFECYCLE, CONFIGURATOR, FILESYSTEM, APT, MAVEN_CONTEXT, GRADLE_ARGUMENTS, GRADLE_OUTPUT, GRADLE_SOURCE, GRADLE_SUPPORT, FILE_DETECTOR));
    Set<String> repositoryOptions = new HashSet<>(Arrays.asList(
      "maven.repo.local.head", "maven.repo.local.tail", "maven.repo.local.tail.ignoreAvailability"));
    try (DirectoryStream<Path> plugins = Files.newDirectoryStream(Paths.get(args[2]), "*.jar")) {
      for (Path plugin : plugins) {
        String name = plugin.getFileName().toString();
        if (!name.startsWith("org.eclipse.m2e.") && !name.startsWith("org.eclipse.jdt.") && !name.startsWith("org.eclipse.buildship.")) continue;
        try (JarFile jar = new JarFile(plugin.toFile())) {
          if (name.startsWith("org.eclipse.m2e.maven.runtime_")) {
            for (JarEntry library : Collections.list(jar.entries())) {
              if (!library.getName().matches("jars/maven-core-[^/]+\\.jar")) continue;
              try (JarInputStream nested = new JarInputStream(jar.getInputStream(library))) {
                for (JarEntry entry; (entry = nested.getNextJarEntry()) != null;) {
                  if (entry.getName().equals("org/apache/maven/internal/aether/DefaultRepositorySystemSessionFactory.class")) {
                    new ClassReader(nested.readAllBytes()).accept(new ClassVisitor(Opcodes.ASM9) {
                      public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
                        if (value instanceof String) repositoryOptions.remove(value);
                        return null;
                      }
                    }, ClassReader.SKIP_CODE);
                  }
                }
              }
            }
          }
          for (String type : new ArrayList<>(remaining)) {
            JarEntry entry = jar.getJarEntry(type + ".class");
            if (entry != null) {
              try (InputStream input = jar.getInputStream(entry)) { transformClass(type, input.readAllBytes()); }
              remaining.remove(type);
            }
          }
        }
      }
    }
    if (!remaining.isEmpty()) throw new IOException("Missing language server APIs: " + remaining);
    if (!repositoryOptions.isEmpty()) throw new IOException("Maven lacks read-only repository chaining: " + repositoryOptions);
    Manifest manifest = new Manifest();
    manifest.getMainAttributes().putValue("Manifest-Version", "1.0");
    manifest.getMainAttributes().putValue("Premain-Class", "gitnest.analysis.AnalysisAgent");
    manifest.getMainAttributes().putValue("Boot-Class-Path", "analysis-agent.jar asm.jar");
    Path classes = Paths.get(args[0]);
    try (JarOutputStream jar = new JarOutputStream(Files.newOutputStream(Paths.get(args[1])), manifest);
         java.util.stream.Stream<Path> files = Files.walk(classes)) {
      for (Path file : (Iterable<Path>) files.filter(Files::isRegularFile)::iterator) {
        jar.putNextEntry(new JarEntry(classes.relativize(file).toString().replace(File.separatorChar, '/')));
        Files.copy(file, jar);
        jar.closeEntry();
      }
    }
  }
}
`;
