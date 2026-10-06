import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { SparklesIcon } from "lucide-react";
import { useState } from "react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { api } from "@/lib/api";
import { BotAvatar } from "./bot-avatar";
import { ErrorNote } from "./common";

function SuggestionRow() {
  const { textInput } = usePromptInputController();
  return (
    <Suggestions className="px-1">
      {t.composer.suggestions.map((s) => (
        <Suggestion
          key={s}
          suggestion={s}
          onClick={(v) => textInput.setInput(v)}
          className="bg-background font-normal text-muted-foreground hover:text-foreground"
        />
      ))}
    </Suggestions>
  );
}

/**
 * The natural-language mission box (AI Elements PromptInput). Submitting creates the mission
 * and opens it, where the plan waits for approval.
 */
export function MissionComposer({ autoFocus = false }: { autoFocus?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const bots = useQuery({ queryKey: ["bots"], queryFn: api.bots.list });
  const published = (bots.data?.items ?? []).filter((b) => b.publishedVersionId);
  const [botId, setBotId] = useState<string | undefined>(undefined);
  const selected = botId ?? published[0]?.id;

  const create = useMutation({
    mutationFn: api.missions.create,
    onSuccess: async (m) => {
      await qc.invalidateQueries({ queryKey: ["missions"] });
      await navigate({ to: "/missions/$missionId", params: { missionId: m.id } });
    },
  });

  const disabled = !selected;

  return (
    <PromptInputProvider>
      <div className="flex flex-col gap-3">
        <PromptInput
          onSubmit={async ({ text }) => {
            const instruction = text.trim();
            if (!instruction || !selected) throw new Error("empty");
            await create.mutateAsync({ instruction, botId: selected });
          }}
          className="[&_[data-slot=input-group]]:rounded-3xl [&_[data-slot=input-group]]:bg-background [&_[data-slot=input-group]]:shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)]"
        >
          <PromptInputBody>
            <PromptInputTextarea
              placeholder={t.composer.placeholder}
              autoFocus={autoFocus}
              disabled={disabled}
              aria-label={t.missions.prompt}
              className="min-h-20 px-5 pt-4 text-base"
            />
          </PromptInputBody>
          <PromptInputFooter className="px-3 pb-3">
            <PromptInputTools>
              {published.length > 0 ? (
                <PromptInputSelect value={selected} onValueChange={setBotId}>
                  <PromptInputSelectTrigger
                    aria-label={t.composer.bot}
                    className="h-9 rounded-full border bg-muted/60 pr-3 pl-1.5"
                  >
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent className="rounded-2xl">
                    {published.map((b) => (
                      <PromptInputSelectItem key={b.id} value={b.id} className="rounded-xl">
                        <span className="flex items-center gap-2">
                          <BotAvatar seed={b.id} size={20} />
                          {b.name}
                        </span>
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              ) : (
                bots.data && (
                  <span className="flex items-center gap-2 pl-2 text-muted-foreground text-sm">
                    {t.composer.noBots}
                    <Button asChild variant="link" size="sm" className="h-auto px-0">
                      <Link to="/bots">{t.composer.publishFirst}</Link>
                    </Button>
                  </span>
                )
              )}
            </PromptInputTools>
            <PromptInputSubmit
              disabled={disabled || create.isPending}
              status={create.isPending ? "submitted" : undefined}
              className="size-10 rounded-full"
              aria-label={t.composer.send}
            >
              {create.isPending ? undefined : <SparklesIcon className="size-4" />}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
        {!disabled && <SuggestionRow />}
        {create.error && <ErrorNote error={create.error} />}
      </div>
    </PromptInputProvider>
  );
}
