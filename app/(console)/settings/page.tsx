import { CreateKeyForm } from "@/components/create-key-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isStoreConfigured, listApiKeys } from "@/lib/store";
import { revokeKeyAction } from "@/app/(console)/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const configured = isStoreConfigured();
  const keys = await listApiKeys();

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          API keys are stored as a SHA-256 hash. The raw key is shown once, when it is created.
          Put that value in the listener&apos;s <span className="font-mono">LISTENER_API_KEY</span> on
          Railway. The listener sends it as a Bearer token to <span className="font-mono">/api/ingest</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create key</CardTitle>
          <CardDescription>
            Keys look like <span className="font-mono">dgb_</span> plus 32 random bytes in hex.
            {!configured ? " Connect Upstash before creating keys." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateKeyForm disabled={!configured} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>Name, prefix, created time, and whether the key is revoked.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No keys yet.
                  </TableCell>
                </TableRow>
              ) : (
                keys.map((key) => (
                  <TableRow key={key.hash}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs">{key.prefix}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {key.createdAt}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {key.lastUsedAt ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.revoked ? "rejected" : "ok"}>
                        {key.revoked ? "Revoked" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={revokeKeyAction}>
                        <input type="hidden" name="hash" value={key.hash} />
                        <Button
                          type="submit"
                          variant="destructive"
                          size="sm"
                          disabled={key.revoked}
                        >
                          Revoke
                        </Button>
                      </form>
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
