import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Mail, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const LoginScreen = () => {
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) toast.error(error.message);
        else toast.success("Account created — you're in!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) toast.error(error.message);
      }
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 relative overflow-hidden">
      {/* Ambient glows */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[20%] left-[5%] w-[380px] h-[380px] rounded-full bg-primary/6 blur-[100px]" />
        <div className="absolute bottom-[15%] right-[-10%] w-[300px] h-[300px] rounded-full bg-secondary/5 blur-[80px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative w-full max-w-xs flex flex-col items-center"
      >
        {/* Logo */}
        <div className="mb-10 text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.1, type: "spring", damping: 18 }}
            className="w-24 h-24 mx-auto mb-5 rounded-3xl overflow-hidden gradient-card border border-border/60 card-shine flex items-center justify-center shadow-xl shadow-black/30"
          >
            <img src="/logo.png" alt="Cosign" className="w-20 h-20 object-contain" />
          </motion.div>
          <h1 className="text-4xl font-black tracking-tight gradient-text">Cosign</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Ranked recommendations from people you trust.
          </p>
        </div>

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="w-full gradient-card card-shine border border-border/60 rounded-3xl p-5 shadow-2xl shadow-black/30"
        >
          <h2 className="text-base font-semibold text-foreground mb-4">
            {isSignUp ? "Create account" : "Welcome back"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="pl-9 h-11 bg-muted/50 border-border/60 text-sm focus:border-primary/50"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isSignUp ? "new-password" : "current-password"}
                className="pl-9 h-11 bg-muted/50 border-border/60 text-sm focus:border-primary/50"
              />
            </div>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full h-11 text-sm font-semibold gradient-accent border-0 text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-90 transition-opacity"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isSignUp ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </motion.div>
          </form>
        </motion.div>

        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          onClick={() => setIsSignUp(!isSignUp)}
          className="mt-5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "Don't have an account? Sign up"}
        </motion.button>
      </motion.div>
    </div>
  );
};

export default LoginScreen;
