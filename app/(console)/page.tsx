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
import { envChecks, isAdminConfigured } from "@/lib/env";
import { isHeartbeatFresh, mentionRows } from "@/lib/mentions";
import { getHeartbeat, isStoreReachable, listEvents } from "@/lib/store";
import type { WakeStatus } from "@/lib/types";
import { WAKE_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [reachable, heartbeat, events] = await Promise.all([
    isStoreReachable(),
    getHeartbeat(),
    listEvents(),
  ]);
  const checks = envChecks();
  const online = heartbeat ? isHeartbeatFresh(heartbeat.receivedAt) : false;
  const mentions = mentionRows(events, 20);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Status</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Listener health and the latest qualified @mentions. Discord Digest posts the reply in
          the channel.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listener</CardTitle>
          <CardDescription>
            Online when a heartbeat was received less than 90 seconds ago. The listener process
            runs on Railway.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <HealthPill label="Listener" ok={online} okText="Online" badText="Offline" />
            <HealthPill label="Store" ok={reachable} okText="Reachable" badText="Unreachable" />
            <HealthPill
              label="Admin"
              ok={isAdminConfigured()}
              okText="Set"
              badText="Not set"
            />
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Metric label="Last heartbeat" value={heartbeat?.receivedAt ?? "—"} />
            <Metric label="Reported at" value={heartbeat?.ts ?? "—"} />
            <Metric label="WS ping" value={formatPing(heartbeat?.ws_ping)} />
            <Metric label="Queue depth" value={heartbeat ? String(heartbeat.queue_depth) : "—"} />
            <Metric label="Uptime" value={heartbeat ? `${heartbeat.uptime_s}s` : "—"} />
            <Metric
              label="Version"
              value={heartbeat?.version ? heartbeat.version : "—"}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Whether each dashboard variable is present. Values are never shown. Bot token, wake
            URL, and the listener API key live on Railway, not in this Vercel project.
          </CardDescription>
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
          <CardTitle>Recent mentions</CardTitle>
          <CardDescription>Last 20 qualified mentions reported by the listener.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Author</TableHead>
                <TableHead>Text</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Wake</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mentions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No mentions recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                mentions.map((mention) => (
                  <TableRow key={mention.messageId}>
                    <TableCell>
                      <div className="font-medium">{mention.author || "unknown"}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {mention.channelId || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs" title={mention.textPreview}>
                      <span className="line-clamp-2 break-words">
                        {mention.textPreview || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {mention.ts || "—"}
                      {mention.backfill ? (
                        <div className="mt-1">
                          <Badge variant="outline">backfill</Badge>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <WakeBadge status={mention.wakeStatus} />
                      {mention.attempts !== null || mention.httpStatus !== null ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {mention.attempts !== null ? `${mention.attempts} attempts` : ""}
                          {mention.httpStatus !== null
                            ? `${mention.attempts !== null ? " · " : ""}HTTP ${mention.httpStatus}`
                            : ""}
                        </div>
                      ) : null}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm break-all">{value}</dd>
    </div>
  );
}

function WakeBadge({ status }: { status: string }) {
  const variant = isWakeStatus(status) ? status : "pending";
  return <Badge variant={variant}>{status || "pending"}</Badge>;
}

function isWakeStatus(value: string): value is WakeStatus {
  return WAKE_STATUSES.some((status) => status === value);
}

function formatPing(ping: number | undefined): string {
  if (ping === undefined || !Number.isFinite(ping) || ping < 0) {
    return "—";
  }
  return `${Math.round(ping)} ms`;
}
