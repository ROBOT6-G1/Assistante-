import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { auth } from "@/integrations/firebase/config";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth-callback")({
  ssr: false,
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const [status, setStatus] = useState("Initialisation de la connexion Google...");

  useEffect(() => {
    const runAuth = async () => {
      try {
        setStatus("Ouverture de la fenêtre de connexion Google...");
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        const result = await signInWithPopup(auth, provider);

        setStatus("Connexion réussie ! Transfert de la session...");
        const credential = GoogleAuthProvider.credentialFromResult(result);
        const idToken = await result.user.getIdToken();

        if (window.opener) {
          window.opener.postMessage(
            {
              type: "GOOGLE_AUTH_SUCCESS",
              idToken,
              accessToken: credential?.accessToken || null,
              email: result.user.email,
              uid: result.user.uid,
            },
            "*",
          );
          setStatus("Session transférée ! Vous pouvez fermer cette fenêtre.");
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          setStatus("Erreur : Impossible de renvoyer la session à la fenêtre principale.");
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(e);
        setStatus(`Erreur de connexion : ${errMsg}`);
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "GOOGLE_AUTH_FAILURE",
              error: errMsg,
            },
            "*",
          );
        }
      }
    };

    runAuth();
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="max-w-md space-y-4">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
        <h1 className="text-xl font-semibold text-foreground">{status}</h1>
        <p className="text-sm text-muted-foreground">
          Veuillez ne pas fermer cette fenêtre. Elle se fermera automatiquement
          une fois la connexion établie.
        </p>
      </div>
    </div>
  );
}
