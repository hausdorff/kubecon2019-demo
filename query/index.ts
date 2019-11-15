import * as k8s from "@pulumi/kubernetes";
import { ResolvedResource } from "@pulumi/pulumi/queryable";
import * as kq from "@pulumi/query-kubernetes";
import * as rx from "rxjs";
import { filter, flatMap, map, toArray, window } from "rxjs/operators";

import * as chalk from "chalk";

const deploymentName = "my-test-logger";

// const podRegex: RegExp = RegExp(".+", "g");
const podRegex: RegExp = RegExp(deploymentName, "g");

// --------------------------------------------------------------------------
// Get logs, tail.
// --------------------------------------------------------------------------

// Set namespace to retreive pods from.
const currNs = "default";

function podLogs(namespace: string, name: string) {
    const obs = new rx.Subject<string>();
    (async function() {
        for await (const line of kq.podLogs(namespace, name)) {
            obs.next(line);
        }
    })();
    return obs;
}

export const ktail = (
    ns: string | undefined,
    podRegex: RegExp
): rx.Observable<{
    name: string;
    logs: string[];
}> => {
    const pods = new rx.Subject<
        kq.WatchEvent<ResolvedResource<k8s.core.v1.Pod>>
    >();
    (async function() {
        for await (const pod of kq.watch("v1", "Pod")) {
            pods.next(pod);
        }
    })();

    return pods.pipe(
        flatMap(pod => {
            if (pod.object.metadata!.namespace !== ns) {
                return [];
            }

            // Ignore pod if it doesn't match the regex.
            if (!podRegex.test(pod.object.metadata.name)) {
                return [];
            }

            if (pod.object.status!.phase !== "Running") {
                return [];
            }

            // Get a log stream if `--stream` was passed in, else just get the output of
            // the standard `logs` request.
            const logs = podLogs(
                pod.object.metadata.namespace,
                pod.object.metadata.name
            );

            // For each particular stream of logs, emit output in windowed intervals of
            // 1 second. This makes the logs slightly more contiguous, so that a bunch
            // of logs from one pod end up output together.
            return logs.pipe(
                filter(logs => logs != null),
                window(rx.timer(0, 1000)),
                flatMap(window =>
                    window.pipe(
                        toArray(),
                        flatMap(logs => (logs.length == 0 ? [] : [logs]))
                    )
                ),
                map(logs => {
                    return { name: pod.object.metadata.name, logs };
                })
            );
        })
    );
};

ktail(currNs, podRegex).forEach(({ name, logs }) => {
    // console.log(`\n${chalk.green(name)}:`);
    const errors = logs.filter(line => RegExp(/error/, "g").test(line));
    if (errors.length > 0) {
        console.log(`Error logged in pod ${name}:`);
    }
    errors.forEach(line => {
        console.log(`     ${line}\n`);
    });
});

(async function watch() {
    for await (const e of kq.watch("v1", "Event")) {
        const { apiVersion, kind, name } = e.object.involvedObject;

        if (
            apiVersion === "apps/v1" &&
            kind === "Deployment" &&
            podRegex.test(name)
        ) {
            const { type, reason, message } = e.object;
            console.log(`${type}: [${reason}] ${message}`);
        }
    }
})();
