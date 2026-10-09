import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { envChecks, isEnvOk } from "@/lib/env";
import { isStoreReachable, listInteractions } from "@/lib/store";
import type { WakeStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [reachable, interactions] = await Promise.all([
    isStoreReachable(),
    listInteractions(20),
  ]);
  const envOk = isEnvOk();
  const checks = envChecks();

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bridge health, configuration, and the latest slash-command interactions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bridge health</CardTitle>
          <CardDescription>
            Env OK means the public key, application id, wake URL, wake key, and admin key are set.
            AI role and guild id have code defaults. Redis is optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <HealthPill label="Store" ok={reachable} okText="Reachable" badText="Unreachable" />
          <HealthPill label="Env" ok={envOk} okText="OK" badText="Incomplete" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>Whether each variable is present. Values are never shown.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variable</TableHead>
                <TableHead>Set</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checks.map((check) => (
                <TableRow key={check.name}>
                  <TableCell className="font-mono text-xs">{check.name}</TableCell>
                  <TableCell>
                    <Badge variant={check.set ? "ok" : "rejected"}>
                      {check.set ? "Set" : "Not set"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent interactions</CardTitle>
          <CardDescription>Last 20 of the 200 most recent records.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Question</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Wake</TableHead>
                <TableHead>Attempts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No interactions recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                interactions.map((interaction) => (
                  <TableRow key={interaction.id}>
                    <TableCell>
                      <div className="font-medium">{interaction.username || "unknown"}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {interaction.userId || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs" title={interaction.question}>
                      <span className="line-clamp-2 break-words">
                        {truncate(interaction.question, 80) || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {interaction.receivedAt || "—"}
                    </TableCell>
                    <TableCell>
                      <WakeBadge status={interaction.wakeStatus} />
                    </TableCell>
                    <TableCell>
                      {interaction.attempts.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <ul className="space-y-1">
                          {interaction.attempts.map((attempt) => (
                            <li key={`${interaction.id}-${attempt.attempt}`} className="text-xs">
                              <span className="font-medium">#{attempt.attempt}</span> {attempt.status}
                              {attempt.httpStatus !== null ? ` HTTP ${attempt.httpStatus}` : ""}
                              {attempt.error ? ` (${attempt.error})` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}

function HealthPill({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  badText: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge variant={ok ? "ok" : "failed"}>{ok ? okText : badText}</Badge>
    </div>
  );
}

function WakeBadge({ status }: { status: WakeStatus }) {
  return <Badge variant={status}>{status}</Badge>;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
