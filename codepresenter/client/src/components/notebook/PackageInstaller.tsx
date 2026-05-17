import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Package, Plus, Loader2 } from 'lucide-react';

interface PackageInstallerProps {
  onPackageInstalled?: () => void;
}

export function PackageInstaller({ onPackageInstalled }: PackageInstallerProps) {
  const [packageName, setPackageName] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installedPackages, setInstalledPackages] = useState<string[]>([]);
  const { toast } = useToast();

  const commonPackages = [
    'numpy', 'pandas', 'matplotlib', 'seaborn', 'plotly',
    'scikit-learn', 'tensorflow', 'torch', 'transformers',
    'requests', 'beautifulsoup4', 'pillow', 'opencv-python'
  ];

  const installPackage = async (packages: string[]) => {
    setIsInstalling(true);
    try {
      const response = await fetch('/api/packages/install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ packages }),
        credentials: 'include',
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Package installed successfully",
          description: `Installed: ${packages.join(', ')}`,
        });
        setInstalledPackages(prev => [...prev, ...packages]);
        setPackageName('');
        onPackageInstalled?.();
      } else {
        toast({
          title: "Installation failed",
          description: result.error || 'Failed to install package',
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Installation error",
        description: 'Network error occurred',
        variant: "destructive",
      });
    } finally {
      setIsInstalling(false);
    }
  };

  const handleInstallCustom = () => {
    if (packageName.trim()) {
      installPackage([packageName.trim()]);
    }
  };

  const handleInstallCommon = (pkg: string) => {
    installPackage([pkg]);
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Package Installer
        </CardTitle>
        <CardDescription>
          Install Python packages on-demand, just like in Google Colab
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Custom package installation */}
        <div className="flex gap-2">
          <Input
            placeholder="Enter package name (e.g., numpy==1.24.0)"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInstallCustom()}
            disabled={isInstalling}
          />
          <Button 
            onClick={handleInstallCustom}
            disabled={!packageName.trim() || isInstalling}
          >
            {isInstalling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Install
          </Button>
        </div>

        {/* Common packages */}
        <div>
          <h4 className="text-sm font-medium mb-2">Quick Install - Common Packages:</h4>
          <div className="flex flex-wrap gap-2">
            {commonPackages.map((pkg) => (
              <Badge
                key={pkg}
                variant={installedPackages.includes(pkg) ? "default" : "outline"}
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground"
                onClick={() => !isInstalling && handleInstallCommon(pkg)}
              >
                {pkg}
                {installedPackages.includes(pkg) && " ✓"}
              </Badge>
            ))}
          </div>
        </div>

        {/* Installation status */}
        {isInstalling && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Installing packages...
          </div>
        )}

        {/* Recently installed */}
        {installedPackages.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">Recently Installed:</h4>
            <div className="flex flex-wrap gap-1">
              {installedPackages.map((pkg, index) => (
                <Badge key={`${pkg}-${index}`} variant="secondary">
                  {pkg}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
