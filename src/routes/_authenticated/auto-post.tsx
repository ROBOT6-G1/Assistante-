import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as tus from "tus-js-client";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listScheduledPosts,
  upsertScheduledPost,
  deleteScheduledPost,
  createImageUploadUrl,
  getPostImageUrl,
  createVideoUploadUrl,
  getPostVideoUrl,
  publishScheduledPostNow,
} from "@/lib/scheduled-posts.functions";
import { listFacebookPages } from "@/lib/dashboard.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Send,
  Trash2,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  Plus,
  Save,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";

const postsQuery = queryOptions({
  queryKey: ["scheduled-posts"],
  queryFn: () => listScheduledPosts(),
});
const pagesQuery = queryOptions({ queryKey: ["fb-pages"], queryFn: () => listFacebookPages() });

export const Route = createFileRoute("/_authenticated/auto-post")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(postsQuery),
      context.queryClient.ensureQueryData(pagesQuery),
    ]),
  component: AutoPostPage,
});

type FormState = {
  id?: string;
  page_id: string | null;
  title: string;
  ai_prompt: string;
  images: { path: string; preview: string }[];
  video_path: string | null;
  video_preview: string | null;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  frequency: "once" | "daily";
  enhance_image: boolean;
};

function todayLocalParts() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function combineToIso(date: string, time: string): string {
  // Interpret as local time
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0).toISOString();
}

function fromIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

async function fileToBase64(
  file: File,
): Promise<{ data_base64: string; content_type: string; filename: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return {
    data_base64: btoa(binary),
    content_type: file.type || "image/jpeg",
    filename: file.name,
  };
}

function AutoPostPage() {
  const { data: posts } = useSuspenseQuery(postsQuery);
  const { data: pages } = useSuspenseQuery(pagesQuery);
  const qc = useQueryClient();

  const initial: FormState = {
    id: undefined,
    page_id: pages[0]?.id ?? null,
    title: "",
    ai_prompt: "",
    images: [],
    video_path: null,
    video_preview: null,
    date: todayLocalParts().date,
    time: todayLocalParts().time,
    frequency: "once",
    enhance_image: true,
  };
  const [form, setForm] = useState<FormState>(initial);
  const [uploading, setUploading] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoPaused, setVideoPaused] = useState(false);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const pendingVideoRef = useRef<{ file: File; path: string } | null>(null);

  const editing = Boolean(form.id);

  const resetForm = () => setForm({ ...initial, ...todayLocalParts() });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) {
          toast.error(`${file.name} : sary lehibe loatra (max 15 Mo)`);
          continue;
        }
        const { path, token, signed_url } = await createImageUploadUrl({
          data: { filename: file.name },
        });
        const { error: upErr } = await supabase.storage
          .from("post-images")
          .uploadToSignedUrl(path, token, file);
        if (upErr) throw new Error(upErr.message);
        setForm((f) => ({
          ...f,
          images: [...f.images, { path, preview: signed_url }],
        }));
      }
      toast.success("Sary voatahiry");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  /* -------- Resumable video upload (tus) -------- */

  const startVideoUpload = (file: File, path: string) => {
    setUploadingVideo(true);
    setVideoPaused(false);
    const url = `${import.meta.env["VITE_SUPABASE_URL"]}/storage/v1/upload/resumable`;
    const upload = new tus.Upload(file, {
      endpoint: url,
      retryDelays: [0, 2000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "post-videos",
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onBeforeRequest: async (req) => {
        const { data } = await supabase.auth.getSession();
        req.setHeader("authorization", `Bearer ${data.session?.access_token ?? ""}`);
        req.setHeader("x-upsert", "true");
      },
      onProgress: (sent, total) => {
        setVideoProgress(total ? Math.round((sent / total) * 100) : 0);
      },
      onError: (err) => {
        setUploadingVideo(false);
        setVideoPaused(true);
        toast.error(`Envoi interrompu : ${err.message}. Cliquez sur "Continuer".`);
      },
      onSuccess: async () => {
        try {
          const preview = await getPostVideoUrl({ data: { path } });
          setForm((f) => ({
            ...f,
            video_path: path,
            video_preview: preview.signed_url,
            // clear images if any — a post is either video or images
            images: [],
          }));
          toast.success("Vidéo voatahiry");
        } catch {
          setForm((f) => ({ ...f, video_path: path, images: [] }));
        }
        setUploadingVideo(false);
        setVideoPaused(false);
        setVideoProgress(100);
        uploadRef.current = null;
      },
    });
    uploadRef.current = upload;
    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0 && prev[0]) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  };

  const handleVideoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 1024 * 1024 * 1024) {
      toast.error("Vidéo lehibe loatra (max 1 Go)");
      return;
    }
    if (!file.type.startsWith("video/")) {
      toast.error("Fichier vidéo uniquement");
      return;
    }
    try {
      const { path } = await createVideoUploadUrl({ data: { filename: file.name } });
      pendingVideoRef.current = { file, path };
      setVideoName(file.name);
      setVideoProgress(0);
      startVideoUpload(file, path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur upload vidéo");
    }
  };

  const resumeVideoUpload = () => {
    const pending = pendingVideoRef.current;
    if (!pending) return;
    startVideoUpload(pending.file, pending.path);
  };

  const cancelVideoUpload = () => {
    uploadRef.current?.abort();
    uploadRef.current = null;
    pendingVideoRef.current = null;
    setUploadingVideo(false);
    setVideoPaused(false);
    setVideoProgress(0);
    setVideoName(null);
  };

  const startEdit = async (row: any) => {
    const parts = fromIso(row.scheduled_at);
    const paths: string[] = row.image_paths?.length
      ? row.image_paths
      : row.image_path
        ? [row.image_path]
        : [];
    const images: { path: string; preview: string }[] = [];
    for (const p of paths) {
      try {
        const r = await getPostImageUrl({ data: { path: p } });
        images.push({ path: p, preview: r.signed_url });
      } catch {}
    }
    let vidPreview: string | null = null;
    if (row.video_path) {
      try {
        const r = await getPostVideoUrl({ data: { path: row.video_path } });
        vidPreview = r.signed_url;
      } catch {}
    }
    setForm({
      id: row.id,
      page_id: row.page_id ?? pages[0]?.id ?? null,
      title: row.title,
      ai_prompt: row.ai_prompt ?? "",
      images,
      video_path: row.video_path ?? null,
      video_preview: vidPreview,
      date: parts.date,
      time: parts.time,
      frequency: row.frequency,
      enhance_image: row.enhance_image,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!form.title.trim()) {
      toast.error("Ampidiro ny lohatenin'ny publication");
      return;
    }
    setSaving(true);
    try {
      // For "daily", user only picks the time — schedule for today at that time,
      // rolling forward to tomorrow if the moment is already past.
      let iso: string;
      if (form.frequency === "daily") {
        const parts = todayLocalParts();
        let candidate = combineToIso(parts.date, form.time);
        if (new Date(candidate).getTime() <= Date.now()) {
          const next = new Date(candidate);
          next.setDate(next.getDate() + 1);
          candidate = next.toISOString();
        }
        iso = candidate;
      } else {
        iso = combineToIso(form.date, form.time);
      }
      await upsertScheduledPost({
        data: {
          id: form.id,
          page_id: form.page_id,
          title: form.title.trim(),
          ai_prompt: form.ai_prompt.trim() || null,
          image_paths: form.images.map((i) => i.path),
          video_path: form.video_path,
          scheduled_at: iso,
          frequency: form.frequency,
          enhance_image: form.enhance_image,
        },
      });
      toast.success(editing ? "Publication novaina" : "Publication voatahiry");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Fafao ity publication ity ?")) return;
    try {
      await deleteScheduledPost({ data: { id } });
      toast.success("Voafafa");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
      if (form.id === id) resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  };

  const publishNow = async (id: string) => {
    setRunningId(id);
    try {
      const res = await publishScheduledPostNow({ data: { id } });
      if (res.ok) toast.success("Publication alefa amin'i Facebook !");
      else toast.error(res.error ?? "Erreur publication");
      qc.invalidateQueries({ queryKey: ["scheduled-posts"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setRunningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold gradient-text">Auto-poste</h1>
        <p className="text-muted-foreground mt-1">
          Planifiez vos publications Facebook. L'IA rédige une description professionnelle et publie
          automatiquement à l'heure choisie.
        </p>
      </div>

      {pages.length === 0 && (
        <Card className="glass p-4 border border-yellow-500/40 bg-yellow-500/5">
          <p className="text-sm">
            Aucune page Facebook connectée. Rendez-vous dans <strong>Facebook</strong> pour en
            connecter une avant de planifier une publication.
          </p>
        </Card>
      )}

      {/* Form */}
      <Card className="glass p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">
            {editing ? "Modifier une publication planifiée" : "Nouvelle publication planifiée"}
          </h2>
          {editing && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={resetForm}>
              <X className="h-4 w-4 mr-1" />
              Annuler
            </Button>
          )}
        </div>

        <div>
          <Label>Titre de la publication</Label>
          <Input
            placeholder="Ex : Promotion spéciale du week-end"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            L'IA génère une description professionnelle à partir de ce titre.
          </p>
        </div>

        <div>
          <Label>Description à donner à l'IA (facultatif)</Label>
          <textarea
            className="mt-1 w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder="Ex : mets l'accent sur la livraison gratuite, ton chaleureux, cible les jeunes parents, mentionne la promo -20%…"
            value={form.ai_prompt}
            onChange={(e) => setForm({ ...form, ai_prompt: e.target.value })}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Ces instructions guident l'IA pour rédiger la meilleure description possible.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Page Facebook</Label>
            <Select
              value={form.page_id ?? ""}
              onValueChange={(v) => setForm({ ...form, page_id: v || null })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choisir une page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.page_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Fréquence</Label>
            <Select
              value={form.frequency}
              onValueChange={(v: "once" | "daily") => setForm({ ...form, frequency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Une seule fois</SelectItem>
                <SelectItem value="daily">Tous les jours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className={form.frequency === "daily" ? "" : "grid gap-4 md:grid-cols-2"}>
          {form.frequency !== "daily" && (
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label>Heure (HH:MM)</Label>
            <Input
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
            {form.frequency === "daily" && (
              <p className="text-xs text-muted-foreground mt-1">
                La publication sera relancée chaque jour à cette heure.
              </p>
            )}
          </div>
        </div>

        <div>
          <Label>Images (plusieurs possibles)</Label>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                <ImageIcon className="h-4 w-4" />
                Ajouter des images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploading}
                />
              </label>
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
            {form.images.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {form.images.map((img) => (
                  <div key={img.path} className="relative">
                    <img
                      src={img.preview}
                      alt="preview"
                      className="h-24 w-24 rounded-md object-cover border"
                    />
                    <Button
                      variant="secondary"
                      size="icon"
                      className="absolute -right-2 -top-2 h-6 w-6"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          images: f.images.filter((i) => i.path !== img.path),
                        }))
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Plusieurs images = publication album. L'IA n'invente pas de nouvelle image : elle
            améliore la première.
          </p>
        </div>

        <div>
          <Label>Vidéo (facultatif, max 1 Go)</Label>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label
                className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent ${uploadingVideo ? "opacity-50 pointer-events-none" : ""}`}
              >
                <VideoIcon className="h-4 w-4" />
                {form.video_path ? "Remplacer la vidéo" : "Ajouter une vidéo"}
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={handleVideoChange}
                  disabled={uploadingVideo}
                />
              </label>
              {videoPaused && (
                <Button size="sm" onClick={resumeVideoUpload}>
                  Continuer
                </Button>
              )}
              {(uploadingVideo || videoPaused) && (
                <Button size="sm" variant="ghost" onClick={cancelVideoUpload}>
                  Annuler
                </Button>
              )}
            </div>
            {(uploadingVideo || videoPaused) && (
              <div className="space-y-1">
                <Progress value={videoProgress} />
                <p className="text-xs text-muted-foreground">
                  {videoName ? `${videoName} — ` : ""}
                  {videoProgress}%{" "}
                  {videoPaused ? "(interrompu — cliquez sur Continuer)" : "envoyé…"}
                </p>
              </div>
            )}
            {form.video_preview && !uploadingVideo && (
              <div className="flex items-center gap-3">
                <video
                  src={form.video_preview}
                  className="h-24 w-40 rounded-md object-cover border"
                  controls
                  preload="metadata"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setForm({ ...form, video_path: null, video_preview: null })}
                >
                  <X className="h-4 w-4 mr-1" />
                  Retirer
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Si une vidéo est jointe, elle sera publiée à la place des images. L'envoi reprend là où
            il s'est arrêté.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <Label className="text-sm">Améliorer l'image avec l'IA</Label>
            <p className="text-xs text-muted-foreground">
              Netteté, luminosité, rendu professionnel — sans changer le contenu.
            </p>
          </div>
          <Switch
            checked={form.enhance_image}
            onCheckedChange={(v) => setForm({ ...form, enhance_image: v })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : editing ? (
              <Save className="h-4 w-4 mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {editing ? "Enregistrer les modifications" : "Créer une publication"}
          </Button>
          {editing && form.id && (
            <Button
              variant="secondary"
              onClick={() => publishNow(form.id!)}
              disabled={runningId === form.id}
            >
              {runningId === form.id ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Publier maintenant
            </Button>
          )}
        </div>
      </Card>

      {/* List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Publications planifiées</h2>
        {posts.length === 0 && (
          <Card className="glass p-6 text-sm text-muted-foreground">
            Aucune publication planifiée pour le moment.
          </Card>
        )}
        {posts.map((p: any) => (
          <Card key={p.id} className="glass p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold truncate">{p.title}</h3>
                  <Badge variant={statusVariant(p.status)}>{statusLabel(p.status)}</Badge>
                  <Badge variant="outline">
                    {p.frequency === "daily" ? "Tous les jours" : "Une fois"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Prévu : {new Date(p.scheduled_at).toLocaleString()}
                  {p.facebook_pages?.page_name && <> · Page : {p.facebook_pages.page_name}</>}
                  {p.last_published_at && (
                    <> · Dernière publication : {new Date(p.last_published_at).toLocaleString()}</>
                  )}
                </p>
                {p.last_error && (
                  <p className="text-xs text-destructive mt-1">Erreur : {p.last_error}</p>
                )}
                {p.ai_description && (
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer text-muted-foreground hover:text-foreground">
                      Voir la description IA
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs bg-muted/30 p-3 rounded-md">
                      {p.ai_description}
                    </pre>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => publishNow(p.id)}
                  disabled={runningId === p.id}
                >
                  {runningId === p.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1" />
                  )}
                  Publier
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                  <Pencil className="h-4 w-4 mr-1" />
                  Modifier
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  switch (s) {
    case "pending":
      return "En attente";
    case "processing":
      return "En cours";
    case "published":
      return "Publié";
    case "failed":
      return "Échec";
    case "cancelled":
      return "Annulé";
    default:
      return s;
  }
}

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "published":
      return "default";
    case "failed":
      return "destructive";
    case "processing":
      return "secondary";
    default:
      return "outline";
  }
}
