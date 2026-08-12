import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  listGeminiKeys,
  upsertGeminiKey,
  deleteGeminiKey,
  toggleGeminiKey,
} from "@/lib/dashboard.functions";
import { Plus, Trash2, KeyRound, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const keysQuery = queryOptions({ queryKey: ["gemini-keys"], queryFn: () => listGeminiKeys() });

export const Route = createFileRoute("/_authenticated/api-keys")({
  loader: ({ context }) => context.queryClient.ensureQueryData(keysQuery),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { data } = useSuspenseQuery(keysQuery);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label: "", api_key: "", is_active: true });

  const save = async () => {
    if (data.length >= 20) {
      toast.error("Maximum 20 clés atteintes");
      return;
    }
    try {
      await upsertGeminiKey({ data: form });
      toast.success("Clé ajoutée");
      setOpen(false);
      setForm({ label: "", api_key: "", is_active: true });
      qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Supprimer cette clé ?")) return;
    await deleteGeminiKey({ data: { id } });
    qc.invalidateQueries({ queryKey: ["gemini-keys"] });
    toast.success("Supprimée");
  };
  const toggle = async (id: string, is_active: boolean) => {
    await toggleGeminiKey({ data: { id, is_active } });
    qc.invalidateQueries({ queryKey: ["gemini-keys"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Clés API Gemini</h1>
          <p className="text-muted-foreground mt-1">
            Rotation automatique —{" "}
            <span className="text-foreground font-medium">
              {data.filter((k) => k.is_active).length}/{data.length}
            </span>{" "}
            actives (max 20).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={data.length >= 20}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une clé
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouvelle clé Gemini</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Étiquette</Label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Ex : Compte principal"
                />
              </div>
              <div>
                <Label>Clé API</Label>
                <Input
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder="AIza..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Obtenez une clé sur https://aistudio.google.com/apikey
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>Active immédiatement</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button onClick={save}>Enregistrer</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {data.length === 0 ? (
        <Card className="glass p-12 text-center">
          <KeyRound className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">
            Aucune clé Gemini. Ajoutez-en pour activer les réponses IA.
          </p>
        </Card>
      ) : (
        <div className="grid gap-2">
          {data.map((k) => {
            const disabled = k.disabled_until && new Date(k.disabled_until) > new Date();
            return (
              <Card key={k.id} className="glass p-4 flex items-center gap-4">
                <KeyRound className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{k.label}</span>
                    <code className="text-xs text-muted-foreground">{k.api_key_masked}</code>
                    {disabled && (
                      <Badge variant="destructive">En pause ({k.error_count} err)</Badge>
                    )}
                    {k.last_used_at && !disabled && <Badge variant="secondary">Utilisée</Badge>}
                  </div>
                </div>
                <Switch checked={k.is_active} onCheckedChange={(v) => toggle(k.id, v)} />
                {disabled && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggle(k.id, true)}
                    title="Réactiver"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" onClick={() => remove(k.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
