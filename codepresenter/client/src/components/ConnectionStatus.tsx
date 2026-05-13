import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, Loader2, Clock } from 'lucide-react';
import { useJupyter } from '@/hooks/use-jupyter';

export function ConnectionStatus() {
  const { 
    connectionStatus, 
    isConnected, 
    lastActivity, 
    connectToKernel, 
    disconnectFromKernel 
  } = useJupyter();

  const getTimeSinceLastActivity = () => {
    if (!lastActivity) return '';
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastActivity.getTime()) / 1000 / 60); // minutes
    if (diff < 1) return 'Active now';
    if (diff === 1) return '1 minute ago';
    return `${diff} minutes ago`;
  };

  const handleConnectionToggle = () => {
    if (isConnected) {
      disconnectFromKernel();
    } else {
      connectToKernel();
    }
  };

  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connecting':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'connected':
        return <Wifi className="h-4 w-4" />;
      case 'disconnected':
      default:
        return <WifiOff className="h-4 w-4" />;
    }
  };

  const getConnectionText = () => {
    switch (connectionStatus) {
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Connected';
      case 'disconnected':
      default:
        return 'Connect';
    }
  };

  const getConnectionVariant = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'default' as const;
      case 'connecting':
        return 'secondary' as const;
      case 'disconnected':
      default:
        return 'outline' as const;
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Button
        variant={getConnectionVariant()}
        size="sm"
        onClick={handleConnectionToggle}
        disabled={connectionStatus === 'connecting'}
        className="flex items-center gap-2"
      >
        {getConnectionIcon()}
        {getConnectionText()}
      </Button>
      
      {isConnected && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{getTimeSinceLastActivity()}</span>
        </div>
      )}
      
      {connectionStatus === 'connected' && (
        <Badge variant="secondary" className="text-xs">
          Python 3
        </Badge>
      )}
    </div>
  );
}
