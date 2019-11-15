import * as kx from "@pulumi/kubernetesx";

const testLoggerImage = "gcr.io/cloud-solutions-images/test-logger";

const testLogger = new kx.PodBuilder({
    containers: [{ image: testLoggerImage }]
});

new kx.Deployment("my-test-logger", {
    spec: testLogger.asDeploymentSpec({ replicas: 3 })
});
