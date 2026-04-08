package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

func doRequest(method, rawURL, apiKey, body string) ([]byte, error) {
	var bodyReader io.Reader
	if body != "" {
		bodyReader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, rawURL, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Login "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}

func decodeData[T any](raw []byte) (T, error) {
	var env struct {
		Data T `json:"data"`
	}
	return env.Data, json.Unmarshal(raw, &env)
}

// ── Types ────────────────────────────────────────────────────────────────────

type CTFactDefinition struct {
	ID             int      `json:"id"`
	Name           string   `json:"name"`
	NameTranslated string   `json:"nameTranslated"`
	SortKey        int      `json:"sortKey"`
	Type           string   `json:"type"`
	Options        []string `json:"options"`
}

type CTEvent struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	StartDate string `json:"startDate"`
}

// ── Facts ─────────────────────────────────────────────────────────────────────

func fetchFacts(ctURL, apiKey string) ([]CTFactDefinition, error) {
	data, err := doRequest("GET", ctURL+"/api/facts", apiKey, "")
	if err != nil {
		return nil, err
	}
	return decodeData[[]CTFactDefinition](data)
}

func updateFactOptions(ctURL, apiKey string, fact CTFactDefinition, options []string) error {
	body, _ := json.Marshal(map[string]any{
		"fieldType": fact.Type,
		"name":      fact.Name,
		"options":   options,
		"sortKey":   fact.SortKey,
	})
	log.Printf("updateFactOptions PUT body: %s", string(body))
	resp, err := doRequest("PUT", fmt.Sprintf("%s/api/facts/%d", ctURL, fact.ID), apiKey, string(body))
	log.Printf("updateFactOptions PUT response: %s err=%v", string(resp), err)
	return err
}

// ── Wiki ──────────────────────────────────────────────────────────────────────

type CTWikiPage struct {
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	Text       string `json:"text"`
}

func fetchWikiCategoryText(ctURL, apiKey string, categoryID int) (string, error) {
	data, err := doRequest("GET",
		fmt.Sprintf("%s/api/wiki/categories/%d/pages?limit=50", ctURL, categoryID),
		apiKey, "")
	if err != nil {
		return "", err
	}
	pages, err := decodeData[[]CTWikiPage](data)
	if err != nil {
		return "", err
	}
	if len(pages) == 0 {
		return "", fmt.Errorf("keine Wiki-Seite in Kategorie %d gefunden", categoryID)
	}

	// The list endpoint omits the text; fetch each page individually.
	var parts []string
	for _, p := range pages {
		pageData, err := doRequest("GET",
			fmt.Sprintf("%s/api/wiki/categories/%d/pages/%s", ctURL, categoryID, url.PathEscape(p.Identifier)),
			apiKey, "")
		if err != nil {
			continue
		}
		full, err := decodeData[CTWikiPage](pageData)
		if err != nil || full.Text == "" {
			continue
		}
		parts = append(parts, full.Text)
	}
	return strings.Join(parts, "\n\n"), nil
}

// ── Events ────────────────────────────────────────────────────────────────────

func fetchEvents(ctURL, apiKey, from, to string) ([]CTEvent, error) {
	q := url.Values{
		"from":      {from},
		"to":        {to},
		"direction": {"forward"},
		"limit":     {"100"},
	}
	data, err := doRequest("GET", ctURL+"/api/events?"+q.Encode(), apiKey, "")
	if err != nil {
		return nil, err
	}
	return decodeData[[]CTEvent](data)
}

// ── Event facts ───────────────────────────────────────────────────────────────

// fetchEventFacts returns all fact values for an event as a factID→string map.
func fetchEventFacts(ctURL, apiKey string, eventID int) (map[int]string, error) {
	data, err := doRequest("GET", fmt.Sprintf("%s/api/events/%d/facts", ctURL, eventID), apiKey, "")
	if err != nil {
		return nil, err
	}
	var result struct {
		Data []struct {
			FactID int             `json:"factId"`
			Value  json.RawMessage `json:"value"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	facts := make(map[int]string, len(result.Data))
	for _, f := range result.Data {
		var s string
		if err := json.Unmarshal(f.Value, &s); err != nil {
			s = strings.Trim(string(f.Value), "\"")
		}
		facts[f.FactID] = s
	}
	return facts, nil
}

func setEventFact(ctURL, apiKey string, eventID, factID int, value string) error {
	body, _ := json.Marshal(map[string]string{"value": value})
	_, err := doRequest("PUT", fmt.Sprintf("%s/api/events/%d/facts/%d", ctURL, eventID, factID), apiKey, string(body))
	return err
}

func setEventFactNum(ctURL, apiKey string, eventID, factID int, value float64) error {
	body, _ := json.Marshal(map[string]any{"value": value})
	_, err := doRequest("PUT", fmt.Sprintf("%s/api/events/%d/facts/%d", ctURL, eventID, factID), apiKey, string(body))
	return err
}
