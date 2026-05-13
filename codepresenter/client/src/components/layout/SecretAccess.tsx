import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key, Plus, X, Eye, EyeOff, Copy, Trash2, Link, Clipboard } from "lucide-react";
import { useToast } from '@/hooks/use-toast';

interface Secret {
  id: string;
  name: string;
  value: string;
  isVisible: boolean;
  isConnected?: boolean;
}

export function SecretAccess() {
  const [secrets, setSecrets] = useState<Secret[]>(() => {
    try {
      const saved = localStorage.getItem('secretAccess');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [newSecretName, setNewSecretName] = useState('');
  const [newSecretValue, setNewSecretValue] = useState('');
  const [nameError, setNameError] = useState('');
  const { toast } = useToast();

  // Persist secrets to localStorage whenever they change
  React.useEffect(() => {
    localStorage.setItem('secretAccess', JSON.stringify(secrets));
  }, [secrets]);

  // Auto-reconnect previously connected secrets on component mount
  React.useEffect(() => {
    const connectedSecrets = secrets.filter(s => s.isConnected);
    connectedSecrets.forEach(secret => {
      fetch('/api/secrets/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: secret.name, 
          value: secret.value 
        })
      }).catch(() => {
        // Silently handle reconnection failures
      });
    });
  }, []); // Only run on mount

  const validateSecretName = (name: string): boolean => {
    if (name.includes(' ')) {
      setNameError('Secret name cannot contain spaces.');
      return false;
    }
    if (secrets.some(secret => secret.name === name)) {
      setNameError('Secret name already exists.');
      return false;
    }
    setNameError('');
    return true;
  };

  const addSecret = () => {
    if (!newSecretName.trim() || !newSecretValue.trim()) {
      toast({
        title: 'Error',
        description: 'Both name and value are required.',
        variant: 'destructive'
      });
      return;
    }

    if (!validateSecretName(newSecretName.trim())) {
      return;
    }

    const newSecret: Secret = {
      id: Date.now().toString(),
      name: newSecretName.trim(),
      value: newSecretValue.trim(),
      isVisible: false,
      isConnected: false
    };

    setSecrets([...secrets, newSecret]);
    setNewSecretName('');
    setNewSecretValue('');
    setIsExpanded(false);
    
    toast({
      title: 'Secret added',
      description: `Secret "${newSecret.name}" has been added.`
    });
  };

  const deleteSecret = (id: string) => {
    const secret = secrets.find(s => s.id === id);
    setSecrets(secrets.filter(s => s.id !== id));
    
    if (secret) {
      toast({
        title: 'Secret deleted',
        description: `Secret "${secret.name}" has been deleted.`
      });
    }
  };

  const toggleVisibility = (id: string) => {
    setSecrets(secrets.map(secret => 
      secret.id === id 
        ? { ...secret, isVisible: !secret.isVisible }
        : secret
    ));
  };

  const copyToClipboard = async (value: string, name: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({
        title: 'Copied',
        description: `Secret "${name}" copied to clipboard.`
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to copy to clipboard.',
        variant: 'destructive'
      });
    }
  };

  const connectSecret = (name: string) => {
    const secret = secrets.find(s => s.name === name);
    
    console.log('🔍 Frontend sending secret:', {
      name,
      valueLength: secret?.value.length,
      hasValue: !!secret?.value
    });

    // Determine context based on current URL/path
    const currentPath = window.location.pathname;
    let context = 'codepresenter'; // default
    let blogId = null;
    
    if (currentPath.includes('/ai-live-blog/') || currentPath.includes('/liveblog/')) {
      context = 'liveblog';
      // Extract blog ID from URL if present
      const blogMatch = currentPath.match(/\/(?:ai-live-blog|liveblog)\/([^\/]+)/);
      if (blogMatch) {
        blogId = blogMatch[1];
      }
    }
    
    // Send secret to backend to inject into kernel
    fetch('/api/secrets/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, 
        value: secret?.value,
        context,
        blogId
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to connect secret');
      }
      return response.json();
    })
    .then(() => {
      // Mark secret as connected
      setSecrets(prevSecrets => 
        prevSecrets.map(s => 
          s.name === name ? { ...s, isConnected: true } : s
        )
      );
      
      toast({
        title: 'Connected',
        description: `Secret "${name}" is now available in your notebook.`
      });
    })
    .catch(() => {
      toast({
        title: 'Error',
        description: 'Failed to connect secret.',
        variant: 'destructive'
      });
    });
  };

  return (
    <div className="p-2 border-t border-neutral-200 dark:border-neutral-700">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Key className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Secret access
        </span>
      </div>

      {/* Existing secrets */}
      {secrets.length > 0 && (
        <div className="space-y-2 mb-3">
          {secrets.map((secret) => (
            <div key={secret.id} className="bg-neutral-50 dark:bg-neutral-700/50 rounded-md p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400 truncate mr-2">
                  {secret.name}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={() => toggleVisibility(secret.id)}
                    title={secret.isVisible ? "Hide value" : "Show value"}
                  >
                    {secret.isVisible ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={() => copyToClipboard(secret.value, secret.name)}
                    title="Copy to clipboard"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`h-6 w-6 p-0 flex-shrink-0 ${secret.isConnected ? 'text-green-600 hover:text-green-700' : ''}`}
                    onClick={() => connectSecret(secret.name)}
                    title={secret.isConnected ? "Connected to notebook" : "Connect to notebook"}
                  >
                    <Link className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0 text-red-500 hover:text-red-700"
                    onClick={() => deleteSecret(secret.id)}
                    title="Delete secret"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400 font-mono bg-white dark:bg-neutral-800 rounded px-2 py-1 break-all overflow-hidden">
                {secret.isVisible ? secret.value : '•'.repeat(Math.min(secret.value.length, 20))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add new secret section */}
      {isExpanded ? (
        <div className="space-y-2 bg-neutral-50 dark:bg-neutral-700/30 rounded-md p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
              Add new secret
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => {
                setIsExpanded(false);
                setNewSecretName('');
                setNewSecretValue('');
                setNameError('');
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="space-y-2">
            <div>
              <Input
                placeholder="Name"
                value={newSecretName}
                onChange={(e) => {
                  setNewSecretName(e.target.value);
                  if (nameError) {
                    validateSecretName(e.target.value.trim());
                  }
                }}
                onBlur={() => {
                  if (newSecretName.trim()) {
                    validateSecretName(newSecretName.trim());
                  }
                }}
                className="h-7 text-xs"
              />
              {nameError && (
                <p className="text-xs text-red-500 mt-1">{nameError}</p>
              )}
            </div>
            
            <Input
              placeholder="Value"
              type="password"
              value={newSecretValue}
              onChange={(e) => setNewSecretValue(e.target.value)}
              className="h-7 text-xs"
            />
            
            <Button
              size="sm"
              onClick={addSecret}
              disabled={!newSecretName.trim() || !newSecretValue.trim() || !!nameError}
              className="h-7 text-xs w-full"
            >
              Add Secret
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded(true)}
          className="w-full justify-start text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
        >
          <Plus className="h-3 w-3 mr-1" />
          Add new secret
        </Button>
      )}
    </div>
  );
}
