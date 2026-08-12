import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { auth } from "@/integrations/firebase/config";
import { GoogleAuthProvider, signInWithPopup, signInWithCredential } from "firebase/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/dashboard" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        toast.success("Compte créé. Connexion réussie.");
        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Connexion réussie !");
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const isCustomDomain =
        typeof window !== "undefined" &&
        !window.location.hostname.includes("localhost") &&
        !window.location.hostname.includes("127.0.0.1") &&
        !window.location.hostname.includes(".run.app");

      if (isCustomDomain) {
        // We will open the Google Sign-In popup pointing to our authorized preview domain
        const authUrl =
          "https://ais-pre-i7b5jeeh6qqkeyb3nv4dw4-469517843202.europe-west2.run.app/auth-callback";

        const width = 500;
        const height = 650;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        const popup = window.open(
          authUrl,
          "GoogleAuth",
          `width=${width},height=${height},left=${left},top=${top}`,
        );

        if (!popup) {
          throw new Error(
            "Le bloqueur de fenêtres contextuelles a empêché l'ouverture du popup de connexion.",
          );
        }

        interface AuthPayload {
          idToken: string;
          accessToken: string | null;
        }

        const authPromise = new Promise<AuthPayload>((resolve, reject) => {
          const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === "GOOGLE_AUTH_SUCCESS") {
              window.removeEventListener("message", handleMessage);
              resolve(event.data);
            } else if (event.data?.type === "GOOGLE_AUTH_FAILURE") {
              window.removeEventListener("message", handleMessage);
              reject(
                new Error(
                  event.data.error || "Échec de l'authentification Google.",
                ),
              );
            }
          };
          window.addEventListener("message", handleMessage);
        });

        const { idToken, accessToken } = await authPromise;
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        await signInWithCredential(auth, credential);

        toast.success("Connexion Google réussie !");
        navigate({ to: "/dashboard" });
        return;
      }

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      toast.success("Connexion Google réussie !");
      navigate({ to: "/dashboard" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Connexion Google échouée";
      toast.error(errMsg);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary mb-4">
            <Bot className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">Assistante Virtuelle</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            IA automatique pour Facebook Messenger & commentaires
          </p>
        </div>

        <Card className="glass p-6">
          <div className="flex gap-2 mb-6 rounded-lg bg-muted p-1">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "signin" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              Connexion
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                mode === "signup" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@example.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "signin" ? "Se connecter" : "Créer le compte"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ou</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
            Continuer avec Google
          </Button>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link to="/" className="hover:text-foreground">
            ← Retour
          </Link>
        </p>
      </div>
    </div>
  );
}
