#!/usr/bin/perl
# Reduce every slip target map to N lean points (default 4) + one point at the minimum and one
# at the maximum lean angle, each with the values of the nearest kept point.
#   perl tools/reduce-points.pl js/dataset.js [n] [minLean] [maxLean] > out.js   (4, 0, 70)
# The N points are the combination of the map's own lean points that follows the original
# curve best over all mu rows (smallest maximum error, then smallest squared error).
# The lean axis is shared by all mu rows, so one set of points per map.
use strict;
use warnings;

my ($file, $n, $minLean, $maxLean) = @ARGV;
die "usage: $0 dataset.js [n] [minLean] [maxLean]\n" unless $file;
$n //= 4; $minLean //= 0; $maxLean //= 70;
open my $h, '<', $file or die "$file: $!\n";
my $s = do { local $/; <$h> };

# piecewise linear, lean descending, values held beyond the ends
sub at {
  my ($l, $v, $x) = @_;
  return $v->[0] if $x >= $l->[0];
  return $v->[-1] if $x <= $l->[-1];
  for my $i (0 .. $#$l - 1) {
    next unless $x <= $l->[$i] && $x >= $l->[$i + 1];
    return $v->[$i] + ($v->[$i + 1] - $v->[$i]) * ($l->[$i] - $x) / ($l->[$i] - $l->[$i + 1]);
  }
}
# all k-subsets of 0..m-1, in order
sub combos {
  my ($m, $k, $start, @cur) = @_;
  return [@cur] if @cur == $k;
  return map { combos($m, $k, $_ + 1, @cur, $_) } $start .. $m - 1;
}

my @log;
sub reduce {
  my ($id, $leanTxt, $rowsTxt) = @_;
  my @lean = split /,/, $leanTxt;
  my @rows = map { [ split /,/ ] } ($rowsTxt =~ /\[([^\[\]]*)\]/g);
  my @xs;                                  # check points: breakpoints and midpoints
  for my $i (0 .. $#lean) { push @xs, $lean[$i]; push @xs, ($lean[$i] + $lean[$i + 1]) / 2 if $i < $#lean }
  my $k = $n < @lean ? $n : scalar @lean;
  my ($best, $bMax, $bSq);
  for my $c (combos(scalar @lean, $k, 0)) {
    my @l = @lean[@$c];
    my ($mx, $sq) = (0, 0);
    for my $r (@rows) {
      my @v = @{$r}[@$c];
      for my $x (@xs) { my $e = abs(at(\@l, \@v, $x) - at(\@lean, $r, $x)); $mx = $e if $e > $mx; $sq += $e * $e }
    }
    if (!defined $best || $mx < $bMax - 1e-9 || (abs($mx - $bMax) < 1e-9 && $sq < $bSq)) { ($best, $bMax, $bSq) = ($c, $mx, $sq) }
  }
  my @l = ($maxLean, @lean[@$best], $minLean);
  my @r = map { my @v = @{$_}[@$best]; [ $v[0], @v, $v[-1] ] } @rows;
  push @log, sprintf('Map %d: lean %s (max difference to the original curve %.2f %%)', $id, join(',', @l), $bMax);
  my $open = chr(123);                     # "{"
  return "$open id: $id, lean: [" . join(',', @l) . "], rows: [" . join(',', map { '[' . join(',', @$_) . ']' } @r) . ']';
}

my $re = qr/\{ id: (\d+), lean: \[([^\]]*)\], rows: (\[.*?\]\])/;
$s =~ s/$re/reduce($1, $2, $3)/ge;
$s =~ s/^(window\.MRCK_DATASET)/"\/\/ Reduced to $n points + min \/ max lean ($minLean \/ $maxLean deg)\n$1"/me;
print $s;
print STDERR "$_\n" for @log;
