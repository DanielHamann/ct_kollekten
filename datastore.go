package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "ct_kollekten"
	keyringUser    = "apikey"
)

type DataStore struct {
	mu   sync.Mutex
	path string
	data storeData
}

type storeData struct {
	CTURL string `json:"ctURL"`
}

func NewDataStore() (*DataStore, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".ct_kollekten")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "data.json")
	ds := &DataStore{path: path}
	ds.load()
	return ds, nil
}

func (ds *DataStore) load() {
	data, err := os.ReadFile(ds.path)
	if err != nil {
		return
	}
	json.Unmarshal(data, &ds.data)
}

func (ds *DataStore) save() error {
	data, err := json.MarshalIndent(ds.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ds.path, data, 0600)
}

func (ds *DataStore) GetCTURL() string {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	return ds.data.CTURL
}

func (ds *DataStore) SetCTURL(url string) error {
	ds.mu.Lock()
	defer ds.mu.Unlock()
	ds.data.CTURL = url
	return ds.save()
}

func (ds *DataStore) GetAPIKey() string {
	key, _ := keyring.Get(keyringService, keyringUser)
	return key
}

func (ds *DataStore) SetAPIKey(key string) error {
	return keyring.Set(keyringService, keyringUser, key)
}
