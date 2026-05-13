import React, { useState } from 'react';
import { Button } from '../ui/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '../ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { hasFirebaseConfig } from '@/lib/firebase';
import { LogIn, LogOut, User } from 'lucide-react';

export function AuthButton() {
  const { currentUser, signInWithGoogle, logout } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  // Don't render anything if Firebase is not configured
  if (!hasFirebaseConfig) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Auth disabled</span>
      </div>
    );
  }

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    setIsLoading(true);
    try {
      await logout();
    } catch (error) {
      console.error('Sign out failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  

  if (!currentUser) {
    return (
      <Button 
        onClick={handleSignIn}
        disabled={isLoading}
        variant="outline"
        size="sm"
        className="flex items-center gap-2 h-8 px-3"
      >
        <LogIn className="h-4 w-4" />
        {isLoading ? 'Signing in...' : 'Sign in with Gmail'}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 h-8 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage 
              src={currentUser.photoURL || undefined} 
              alt={currentUser.displayName || 'User'} 
            />
            <AvatarFallback className="text-xs">
              {currentUser.displayName?.charAt(0) || currentUser.email?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium max-w-[120px] truncate">
            {currentUser.displayName || currentUser.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 min-w-[320px]" style={{ zIndex: 9999 }}>
        <div className="flex items-center gap-2 p-2">
          <Avatar className="h-8 w-8">
            <AvatarImage 
              src={currentUser.photoURL || undefined} 
              alt={currentUser.displayName || 'User'} 
            />
            <AvatarFallback>
              {currentUser.displayName?.charAt(0) || currentUser.email?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">
              {currentUser.displayName || 'User'}
            </span>
            <span className="text-xs text-muted-foreground truncate">
              {currentUser.email}
            </span>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="flex items-center gap-2">
          <User className="h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          onClick={handleSignOut}
          disabled={isLoading}
          className="flex items-center gap-2 text-red-600 focus:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          {isLoading ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
