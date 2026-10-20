export const GRADLE_ANALYSIS_INIT = String.raw`
import java.nio.file.Paths
import java.security.MessageDigest

def configuration = new File(System.getenv('GITNEST_ANALYSIS_CONFIGURATION')).readLines('UTF-8')
def runtime = new File(configuration[0]).canonicalFile
def roots = configuration.drop(1).collect { Paths.get(it).toRealPath() }
def outputFor = { project ->
    def source = project.projectDir.toPath().toRealPath()
    if (!roots.any { source.startsWith(it) }) {
        throw new GradleException("Gradle project is outside protected roots: " + source)
    }
    def key = MessageDigest.getInstance('SHA-256')
        .digest(source.toString().toLowerCase(Locale.ROOT).getBytes('UTF-8')).encodeHex().toString()
    new File(runtime, 'gradle-output/' + key)
}
gradle.beforeProject { project ->
    project.layout.buildDirectory.set(new File(outputFor(project), 'build'))
}
gradle.projectsEvaluated {
    gradle.rootProject.allprojects { project ->
        def output = outputFor(project)
        project.layout.buildDirectory.set(new File(output, 'build'))
        project.plugins.withId('java') {
            project.sourceSets.each { sourceSet ->
                def classes = new File(output, 'classes/' + sourceSet.name)
                sourceSet.java.destinationDirectory.set(classes)
                sourceSet.output.resourcesDir = new File(output, 'resources/' + sourceSet.name)
                project.tasks.named(sourceSet.compileJavaTaskName).configure { task ->
                    task.destinationDirectory.set(classes)
                    task.options.generatedSourceOutputDirectory.set(new File(output, 'generated/' + sourceSet.name))
                }
            }
            project.pluginManager.apply('eclipse')
            project.eclipse.classpath.defaultOutputDir = new File(output, 'eclipse-classes')
        }
    }
}
`;
