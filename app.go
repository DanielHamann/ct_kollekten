package main

import (
	"context"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"
)

const kollektenFactID = 4
const betragFactID = 2
const wikiCategoryID = 13

var dateRe = regexp.MustCompile(`^\d{1,2}\.\d{1,2}\.\d{4}$`)

type App struct {
	ctx     context.Context
	store   *DataStore
	mu      sync.Mutex
	entries []KollektenEintrag // in-memory cache of last Excel parse
}

func NewApp() *App {
	store, err := NewDataStore()
	if err != nil {
		panic(err)
	}
	return &App{store: store}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ── Settings ──────────────────────────────────────────────────────────────────

type Settings struct {
	CTURL  string `json:"ctURL"`
	APIKey string `json:"apiKey"`
}

func (a *App) GetSettings() Settings {
	return Settings{
		CTURL:  a.store.GetCTURL(),
		APIKey: a.store.GetAPIKey(),
	}
}

func (a *App) SaveSettings(ctURL, apiKey string) error {
	if err := a.store.SetCTURL(ctURL); err != nil {
		return err
	}
	return a.store.SetAPIKey(apiKey)
}

func (a *App) TestConnection() error {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()
	if ctURL == "" || apiKey == "" {
		return fmt.Errorf("URL und API-Schlüssel müssen gesetzt sein")
	}
	facts, err := fetchFacts(ctURL, apiKey)
	if err != nil {
		return err
	}
	for _, f := range facts {
		if f.ID == kollektenFactID {
			return nil
		}
	}
	return fmt.Errorf("Fakt mit ID %d nicht gefunden – bitte prüfen", kollektenFactID)
}

// ── Wiki Import ───────────────────────────────────────────────────────────────

type KollektenEintrag struct {
	Datum          string `json:"datum"`
	Kollektengrund string `json:"kollektengrund"`
	Betrag         string `json:"betrag"`
}

func (a *App) GetWikiRaw() (string, error) {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()
	data, err := doRequest("GET",
		fmt.Sprintf("%s/api/wiki/categories/%d/pages?limit=50", ctURL, wikiCategoryID),
		apiKey, "")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) GetWikiEntries() ([]KollektenEintrag, error) {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()

	text, err := fetchWikiCategoryText(ctURL, apiKey, wikiCategoryID)
	if err != nil {
		return nil, err
	}

	entries := parseWikiMarkdown(text)

	a.mu.Lock()
	a.entries = entries
	a.mu.Unlock()

	return entries, nil
}

func parseWikiMarkdown(text string) []KollektenEintrag {
	var entries []KollektenEintrag
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "|") {
			continue
		}
		cols := strings.Split(line, "|")
		// "| a | b | c |" splits to ["", "a", "b", "c", ""]
		if len(cols) < 4 {
			continue
		}
		datum := strings.TrimSpace(cols[1])
		zweck := strings.TrimSpace(cols[2])
		betrag := strings.TrimSpace(cols[3])
		if datum == "" || strings.Contains(datum, "---") || datum == "Datum" {
			continue
		}
		if !dateRe.MatchString(datum) {
			continue
		}
		entries = append(entries, KollektenEintrag{
			Datum:          datum,
			Kollektengrund: zweck,
			Betrag:         betrag,
		})
	}
	return entries
}

func (a *App) GetEntries() []KollektenEintrag {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.entries
}

// ── Fact Options ──────────────────────────────────────────────────────────────

type OptionsPreview struct {
	Existing []string `json:"existing"`
	New      []string `json:"new"`
}

const maxOptions = 14
const wikiReferenceOption = "Siehe Kollektenübersicht im Wiki"

// last15Unique deduplicates candidates and returns the last (most recent) 15.
func last15Unique(candidates []string) []string {
	// Track insertion order, but move duplicates to their latest position.
	order := []string{}
	pos := map[string]int{}
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		c = strings.ReplaceAll(c, ",", ";")
		if c == "" {
			continue
		}
		if i, exists := pos[c]; exists {
			// Remove from current position and re-append at end.
			order = append(order[:i], order[i+1:]...)
			for k, v := range pos {
				if v > i {
					pos[k] = v - 1
				}
			}
		}
		pos[c] = len(order)
		order = append(order, c)
	}
	if len(order) > maxOptions {
		order = order[len(order)-maxOptions:]
	}
	return order
}

// GetOptionsPreview returns current CT options and the proposed replacement
// list (last 15 unique candidates from the wiki) – without writing anything.
func (a *App) GetOptionsPreview(candidates []string) (*OptionsPreview, error) {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()

	facts, err := fetchFacts(ctURL, apiKey)
	if err != nil {
		return nil, err
	}
	var existing []string
	for _, f := range facts {
		if f.ID == kollektenFactID {
			existing = f.Options
			break
		}
	}

	proposed := append(last15Unique(candidates), wikiReferenceOption)
	return &OptionsPreview{Existing: existing, New: proposed}, nil
}

// SyncOptions replaces the CT options list with the last 14 unique entries plus
// the permanent wiki reference. It then scans events for the current and next
// year and replaces any Kollektengrund that is no longer in the new list with
// the wiki reference option.
func (a *App) SyncOptions(newOptions []string) error {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()

	facts, err := fetchFacts(ctURL, apiKey)
	if err != nil {
		return err
	}

	var fact *CTFactDefinition
	for _, f := range facts {
		if f.ID == kollektenFactID {
			fc := f
			fact = &fc
			break
		}
	}
	if fact == nil {
		return fmt.Errorf("Fakt mit ID %d nicht gefunden", kollektenFactID)
	}

	// Strip the wiki reference if it was passed in from the preview, then re-append it at the end.
	var filtered []string
	for _, o := range newOptions {
		if o != wikiReferenceOption {
			filtered = append(filtered, o)
		}
	}
	opts := append(last15Unique(filtered), wikiReferenceOption)
	log.Printf("SyncOptions: updating fact %d with %d options: %v", kollektenFactID, len(opts), opts)
	if err := updateFactOptions(ctURL, apiKey, *fact, opts); err != nil {
		log.Printf("SyncOptions: updateFactOptions error: %v", err)
		return err
	}
	log.Printf("SyncOptions: fact options updated successfully")

	// Build set of valid options after update.
	validOpts := make(map[string]bool, len(opts))
	for _, o := range opts {
		validOpts[o] = true
	}

	// Fetch events for current + next year to catch all relevant ones.
	now := time.Now()
	from := fmt.Sprintf("%d-01-01", now.Year())
	to := fmt.Sprintf("%d-12-31", now.Year()+1)
	events, err := fetchEvents(ctURL, apiKey, from, to)
	if err != nil {
		log.Printf("SyncOptions: fetchEvents error: %v", err)
		return err
	}
	log.Printf("SyncOptions: checking %d events for stale Kollektengrund", len(events))

	type result struct{ err error }
	ch := make(chan result, len(events))
	for _, ev := range events {
		go func(eventID int) {
			facts, err := fetchEventFacts(ctURL, apiKey, eventID)
			if err != nil {
				ch <- result{nil} // skip silently
				return
			}
			current := strings.ReplaceAll(facts[kollektenFactID], ",", ";")
			if current != "" && !validOpts[current] {
				log.Printf("SyncOptions: event %d has stale value %q, replacing", eventID, current)
				err = setEventFact(ctURL, apiKey, eventID, kollektenFactID, wikiReferenceOption)
				if err != nil {
					log.Printf("SyncOptions: setEventFact error for event %d: %v", eventID, err)
				}
			}
			ch <- result{err}
		}(ev.ID)
	}
	for range events {
		if r := <-ch; r.err != nil {
			return r.err
		}
	}
	return nil
}

// ── Gottesdienste ─────────────────────────────────────────────────────────────

type EventWithFact struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	StartDate     string `json:"startDate"`
	CurrentValue  string `json:"currentValue"`
	CurrentBetrag string `json:"currentBetrag"`
}

// GetEvents fetches events for the given date range and their current fact
// values for Kollektengrund and Betrag. Fact lookups run in parallel.
func (a *App) GetEvents(from, to string) ([]EventWithFact, error) {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()

	allEvents, err := fetchEvents(ctURL, apiKey, from, to)
	if err != nil {
		return nil, err
	}

	var events []CTEvent
	for _, ev := range allEvents {
		lower := strings.ToLower(ev.Name)
		if strings.Contains(lower, "gottesdienst") && !strings.Contains(lower, "taufgottesdienst") {
			events = append(events, ev)
		}
	}

	results := make([]EventWithFact, len(events))
	for i, ev := range events {
		results[i] = EventWithFact{ID: ev.ID, Name: ev.Name, StartDate: ev.StartDate}
	}

	type factsResult struct {
		idx   int
		facts map[int]string
	}
	ch := make(chan factsResult, len(events))
	for i, ev := range events {
		go func(idx, eventID int) {
			facts, _ := fetchEventFacts(ctURL, apiKey, eventID)
			ch <- factsResult{idx, facts}
		}(i, ev.ID)
	}
	for range events {
		r := <-ch
		if r.facts != nil {
			results[r.idx].CurrentValue = r.facts[kollektenFactID]
			results[r.idx].CurrentBetrag = r.facts[betragFactID]
		}
	}

	return results, nil
}

func (a *App) SetKollektengrund(eventID int, value string) error {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()
	return setEventFact(ctURL, apiKey, eventID, kollektenFactID, value)
}

func (a *App) SetKollektenbetrag(eventID int, betragStr string) error {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()
	s := strings.TrimSpace(betragStr)
	s = strings.ReplaceAll(s, "€", "")
	s = strings.ReplaceAll(s, "\u00a0", "")
	s = strings.TrimSpace(s)
	// Convert German decimal format to dot notation for CT storage.
	if strings.Contains(s, ",") {
		s = strings.ReplaceAll(s, ".", "")  // remove thousands separator
		s = strings.ReplaceAll(s, ",", ".") // decimal comma → dot
	}
	return setEventFact(ctURL, apiKey, eventID, betragFactID, s)
}

// GetFactOptions returns the current options list from ChurchTools for use
// in dropdowns.
func (a *App) GetFactOptions() ([]string, error) {
	ctURL := a.store.GetCTURL()
	apiKey := a.store.GetAPIKey()

	facts, err := fetchFacts(ctURL, apiKey)
	if err != nil {
		return nil, err
	}
	for _, f := range facts {
		if f.ID == kollektenFactID {
			return f.Options, nil
		}
	}
	return nil, fmt.Errorf("Fakt mit ID %d nicht gefunden", kollektenFactID)
}
